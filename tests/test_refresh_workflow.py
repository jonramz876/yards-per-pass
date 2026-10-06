"""Refresh IO, PR A: the refresh workflow keeps the properties the skip-unchanged
design depends on (docs/superpowers/specs/2026-10-06-refresh-io-design.md, PR A point 11).
Text checks so they run in CI without PyYAML; one extra parse when PyYAML is installed.
"""
import os

import pytest

import ingest


# --- the workflow file ------------------------------------------------------------

WORKFLOWS = os.path.join(os.path.dirname(__file__), '..', '.github', 'workflows')


def _workflow_text(name):
    with open(os.path.join(WORKFLOWS, name), encoding='utf-8') as f:
        return f.read().replace('\r\n', '\n')


def _step_block(text, name):
    """The text of one step, from its `- name:` line to the next step."""
    start = text.index(f"      - name: {name}\n")
    nxt = text.find("\n      - ", start + 1)
    return text[start:] if nxt == -1 else text[start:nxt]


class TestWorkflowFile:
    """A reviewed checklist in code: the refresh workflow keeps the properties the
    skip-unchanged design depends on (spec PR A point 11)."""

    def test_step_order(self):
        text = _workflow_text('data-refresh.yml')
        names = [line.split('- name: ', 1)[1] for line in text.splitlines() if line.startswith('      - name: ')]
        assert names == [
            'Set up Python', 'Cache pip dependencies', 'Install dependencies', 'Check for offseason',
            'Resolve season', 'Restore refresh state', 'Run ingest', 'Trigger ISR revalidation',
            'Save refresh state', 'Keep scheduled workflow alive',
        ]

    def test_cron_lines_and_concurrency_group_unchanged(self):
        text = _workflow_text('data-refresh.yml')
        assert "    - cron: '17 13 * * *'" in text
        assert "    - cron: '17 1,5,9,17,21 * 1-2,9-12 *'" in text
        assert text.count('- cron:') == 2
        assert "concurrency:\n  group: data-refresh\n  cancel-in-progress: false\n" in text

    def test_state_is_restored_with_a_unique_key_and_a_prefix_fallback(self):
        block = _step_block(_workflow_text('data-refresh.yml'), 'Restore refresh state')
        assert "uses: actions/cache/restore@v4" in block
        assert "path: .ingest-state" in block
        assert "key: ingest-state-${{ github.run_id }}-${{ github.run_attempt }}" in block
        assert "restore-keys: |\n            ingest-state-\n" in block
        assert "if: steps.offseason.outputs.skip != 'true'" in block

    def test_ingest_gets_the_state_file_the_token_and_the_force_flag(self):
        block = _step_block(_workflow_text('data-refresh.yml'), 'Run ingest')
        assert "id: ingest" in block
        assert "--state-file .ingest-state/state.json" in block
        assert "GH_TOKEN: ${{ github.token }}" in block
        assert '"${{ github.event.inputs.force }}" = "true"' in block and 'FORCE="--force"' in block

    def test_revalidate_is_gated_on_changed_and_records_success(self):
        block = _step_block(_workflow_text('data-refresh.yml'), 'Trigger ISR revalidation')
        assert ("if: success() && steps.offseason.outputs.skip != 'true' "
                "&& steps.ingest.outputs.changed != 'false'") in block
        ok_branch = block.split('if [ "$STATUS" = "200" ]; then', 1)[1].split('else', 1)[0]
        assert "date -u +%Y-%m-%dT%H:%M:%SZ > .ingest-state/revalidated_at" in ok_branch
        # the marker format is the one ingest parses
        assert ingest._STAMP_FORMAT == "%Y-%m-%dT%H:%M:%SZ"
        assert ingest.REVALIDATED_MARKER == "revalidated_at"

    def test_state_is_saved_after_revalidate_even_when_ingest_failed(self):
        block = _step_block(_workflow_text('data-refresh.yml'), 'Save refresh state')
        assert "uses: actions/cache/save@v4" in block
        assert "if: always() && steps.offseason.outputs.skip != 'true' && hashFiles('.ingest-state/state.json') != ''" in block
        assert "key: ingest-state-${{ github.run_id }}-${{ github.run_attempt }}" in block

    def test_keepalive_still_always_runs(self):
        block = _step_block(_workflow_text('data-refresh.yml'), 'Keep scheduled workflow alive')
        assert "if: always()\n" in block
        assert 'actions/workflows/data-refresh.yml/enable' in block

    def test_force_input_is_a_checkbox(self):
        text = _workflow_text('data-refresh.yml')
        inputs = text.split('workflow_dispatch:', 1)[1].split('permissions:', 1)[0]
        assert "      force:\n" in inputs and "        type: boolean\n" in inputs

    def test_seed_workflow_is_unaffected(self):
        text = _workflow_text('seed.yml')
        assert '--state-file' not in text and '--force' not in text and 'ingest-state' not in text

    def test_yaml_parses(self):
        yaml = pytest.importorskip('yaml')
        doc = yaml.safe_load(_workflow_text('data-refresh.yml'))
        steps = doc['jobs']['refresh']['steps']
        assert [s.get('id') for s in steps if s.get('id')] == ['offseason', 'vars', 'ingest']
        assert doc['concurrency'] == {'group': 'data-refresh', 'cancel-in-progress': False}

    @pytest.mark.parametrize("step", ['Restore refresh state', 'Save refresh state'])
    def test_a_cache_outage_can_never_fail_the_refresh(self, step):
        """Chaos RISK-4: the cache is an optimisation. If the cache service is down the
        restore must not stop the ingest (no state = a full run) and the save must not
        turn a good refresh red."""
        block = _step_block(_workflow_text('data-refresh.yml'), step)
        assert "\n        continue-on-error: true" in block
