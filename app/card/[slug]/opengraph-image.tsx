// app/card/[slug]/opengraph-image.tsx — shareable stat card
import { ImageResponse } from "next/og";
import { getPlayerBySlug } from "@/lib/data/players";
import { getTeam } from "@/lib/data/teams";
// No createServerClient — crashes in OG image context on Vercel

export const runtime = "nodejs";
export const alt = "Player Stat Card — Yards Per Pass";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const interBold = fetch(
  "https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuFuYMZhrib2Bg-4.ttf"
).then((res) => res.arrayBuffer());

// Radar geometry
const CX = 150, CY = 140, R = 110;
function hexPt(r: number, i: number): [number, number] {
  const a = -Math.PI / 2 + (i * Math.PI) / 3;
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
}
function mkPath(values: number[]): string {
  return values.map((pct, i) => {
    const s = Math.max(0, Math.min(isNaN(pct) ? 0 : pct, 100));
    const [x, y] = hexPt((s / 100) * R, i);
    return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ") + " Z";
}
// Static paths
const OUTER = (() => { const p = Array.from({length:6},(_,i)=>hexPt(R,i)); return p.map(([x,y],i)=>`${i===0?"M":"L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ")+" Z"; })();
const MID = (() => { const p = Array.from({length:6},(_,i)=>hexPt(55,i)); return p.map(([x,y],i)=>`${i===0?"M":"L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ")+" Z"; })();
const AX = Array.from({length:6},(_,i)=>hexPt(R,i));
const LP = [{x:150,y:14},{x:270,y:78},{x:270,y:210},{x:150,y:272},{x:30,y:210},{x:30,y:78}];

type Fmt = { key: string; label: string; fmt: (v: number) => string };
const QB_L = ["EPA/DB","CPOE","DB/G","aDOT","INT Rate","Success%"];
const QB_S: Fmt[] = [
  {key:"epa_per_db",label:"EPA/DB",fmt:v=>v.toFixed(2)},
  {key:"cpoe",label:"CPOE",fmt:v=>(v>=0?"+":"")+v.toFixed(1)},
  {key:"any_a",label:"ANY/A",fmt:v=>v.toFixed(1)},
  {key:"passer_rating",label:"Rating",fmt:v=>v.toFixed(1)},
  {key:"passing_yards",label:"Pass Yds",fmt:v=>Math.round(v).toLocaleString()},
  {key:"touchdowns",label:"Pass TD",fmt:v=>Math.round(v).toString()},
  {key:"success_rate",label:"Success%",fmt:v=>(v*100).toFixed(1)+"%"},
];
const WR_L = ["Tgt/G","EPA/Tgt","CROE","aDOT","YAC/Rec","YPRR"];
const WR_S: Fmt[] = [
  {key:"epa_per_target",label:"EPA/Tgt",fmt:v=>v.toFixed(2)},
  {key:"yards_per_route_run",label:"YPRR",fmt:v=>v.toFixed(2)},
  {key:"receiving_yards",label:"Yards",fmt:v=>Math.round(v).toLocaleString()},
  {key:"receiving_tds",label:"TD",fmt:v=>Math.round(v).toString()},
  {key:"catch_rate",label:"Catch%",fmt:v=>(v*100).toFixed(1)+"%"},
  {key:"target_share",label:"Tgt Share",fmt:v=>(v*100).toFixed(1)+"%"},
];
const RB_L = ["Car/G","EPA/Car","Stuff Av","Expl%","Tgt/G","Success%"];
const RB_S: Fmt[] = [
  {key:"epa_per_carry",label:"EPA/Car",fmt:v=>v.toFixed(2)},
  {key:"rushing_yards",label:"Rush Yds",fmt:v=>Math.round(v).toLocaleString()},
  {key:"rushing_tds",label:"Rush TD",fmt:v=>Math.round(v).toString()},
  {key:"yards_per_carry",label:"YPC",fmt:v=>v.toFixed(1)},
  {key:"success_rate",label:"Success%",fmt:v=>(v*100).toFixed(1)+"%"},
  {key:"stuff_rate",label:"Stuff%",fmt:v=>(v*100).toFixed(1)+"%"},
];

export default async function Image({ params }: { params: { slug: string } }) {
  const fontData = await interBold;
  const player = await getPlayerBySlug(params.slug);
  const team = player ? getTeam(player.current_team_id) : null;
  const tc = team?.primaryColor || "#0f172a";
  const name = player?.player_name || "Player";
  const pos = player?.position || "";
  const isQB = pos === "QB";
  const isRB = pos === "RB" || pos === "FB";

  // Fetch single player stats
  let labels = isQB ? QB_L : isRB ? RB_L : WR_L;
  let statFmts = isQB ? QB_S : isRB ? RB_S : WR_S;
  let rv = [50,50,50,50,50,50]; // default mid
  let sr: {l:string;v:string}[] = statFmts.map(d=>({l:d.label,v:"\u2014"}));

  if (player) {
    try {
      const tbl = isQB ? "qb_season_stats" : isRB ? "rb_season_stats" : "receiver_season_stats";
      const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const sbKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      const resp = await fetch(
        `${sbUrl}/rest/v1/${tbl}?player_id=eq.${player.player_id}&season=eq.2025&select=*&limit=1`,
        { headers: { apikey: sbKey!, Authorization: `Bearer ${sbKey}` }, signal: ctrl.signal }
      );
      clearTimeout(timer);
      const arr = await resp.json();
      const data = arr?.[0] ?? null;
      if (data) {
        const s = data as Record<string,unknown>;
        const n = (k:string):number => {const v=s[k]; return typeof v==="number"?v:NaN;};
        sr = statFmts.map(d=>({l:d.label, v:isNaN(n(d.key))?"\u2014":d.fmt(n(d.key))}));
        if (isQB) {
          rv=[(n("epa_per_db")+0.2)/0.5*100,(n("cpoe")+5)/12*100,(n("dropbacks")/Math.max(n("games"),1)-20)/20*100,(n("adot")-5)/8*100,(1-(n("int_pct")||3)/100*4)*100,((n("success_rate")||0)-0.3)/0.25*100];
        } else if (isRB) {
          rv=[(n("carries")/Math.max(n("games"),1)-5)/15*100,(n("epa_per_carry")+0.15)/0.35*100,(1-(n("stuff_rate")||0.2))/0.3*100,((n("explosive_rate")||0)-0.05)/0.15*100,((n("targets")||0)/Math.max(n("games"),1))/5*100,((n("success_rate")||0)-0.3)/0.25*100];
        } else {
          rv=[(n("targets")/Math.max(n("games"),1)-2)/8*100,(n("epa_per_target")+0.1)/0.4*100,((n("croe")||0)+0.1)/0.2*100,(n("air_yards_per_target")-5)/10*100,((n("yac_per_reception")||0)-2)/8*100,((n("yards_per_route_run")||0)-0.5)/2.5*100];
        }
      }
    } catch { /* stats unavailable — show defaults */ }
  }

  const rp = mkPath(rv);
  const dots = rv.map((p,i)=>{const s=Math.max(0,Math.min(isNaN(p)?0:p,100));return hexPt((s/100)*R,i);});
  while(sr.length<7) sr.push({l:"",v:""});

  return new ImageResponse(
    (
      <div style={{width:"100%",height:"100%",display:"flex",flexDirection:"column",backgroundColor:"#ffffff",fontFamily:"Inter"}}>
        <div style={{width:"100%",height:8,backgroundColor:tc,display:"flex"}} />
        <div style={{display:"flex",padding:"20px 44px 8px"}}>
          <div style={{display:"flex",flexDirection:"column"}}>
            <div style={{display:"flex",fontSize:44,fontWeight:800,color:"#0f172a"}}>{name}</div>
            <div style={{display:"flex",fontSize:18,color:"#64748b",marginTop:4}}>{pos} {team?`\u00B7 ${team.name}`:""} {"\u00B7"} 2025</div>
          </div>
        </div>
        <div style={{display:"flex",flex:1,padding:"0 44px"}}>
          <div style={{display:"flex",width:300,height:290,alignItems:"center",justifyContent:"center"}}>
            <svg viewBox="0 0 300 290" width="300" height="290">
              <path d={OUTER} fill="none" stroke="#e2e8f0" strokeWidth="1" />
              <path d={MID} fill="rgba(251,191,36,0.08)" stroke="rgba(245,158,11,0.5)" strokeWidth="0.75" />
              <line x1={CX} y1={CY} x2={AX[0][0]} y2={AX[0][1]} stroke="#f1f5f9" strokeWidth="0.5" />
              <line x1={CX} y1={CY} x2={AX[1][0]} y2={AX[1][1]} stroke="#f1f5f9" strokeWidth="0.5" />
              <line x1={CX} y1={CY} x2={AX[2][0]} y2={AX[2][1]} stroke="#f1f5f9" strokeWidth="0.5" />
              <line x1={CX} y1={CY} x2={AX[3][0]} y2={AX[3][1]} stroke="#f1f5f9" strokeWidth="0.5" />
              <line x1={CX} y1={CY} x2={AX[4][0]} y2={AX[4][1]} stroke="#f1f5f9" strokeWidth="0.5" />
              <line x1={CX} y1={CY} x2={AX[5][0]} y2={AX[5][1]} stroke="#f1f5f9" strokeWidth="0.5" />
              <path d={rp} fill={`${tc}25`} stroke={tc} strokeWidth="2.5" />
              <circle cx={dots[0][0]} cy={dots[0][1]} r="4" fill={tc} />
              <circle cx={dots[1][0]} cy={dots[1][1]} r="4" fill={tc} />
              <circle cx={dots[2][0]} cy={dots[2][1]} r="4" fill={tc} />
              <circle cx={dots[3][0]} cy={dots[3][1]} r="4" fill={tc} />
              <circle cx={dots[4][0]} cy={dots[4][1]} r="4" fill={tc} />
              <circle cx={dots[5][0]} cy={dots[5][1]} r="4" fill={tc} />
              <text x={LP[0].x} y={LP[0].y} textAnchor="middle" fontSize="13" fill="#475569" fontWeight="600" fontFamily="Inter">{labels[0]}</text>
              <text x={LP[1].x} y={LP[1].y} textAnchor="start" fontSize="13" fill="#475569" fontWeight="600" fontFamily="Inter">{labels[1]}</text>
              <text x={LP[2].x} y={LP[2].y} textAnchor="start" fontSize="13" fill="#475569" fontWeight="600" fontFamily="Inter">{labels[2]}</text>
              <text x={LP[3].x} y={LP[3].y} textAnchor="middle" fontSize="13" fill="#475569" fontWeight="600" fontFamily="Inter">{labels[3]}</text>
              <text x={LP[4].x} y={LP[4].y} textAnchor="end" fontSize="13" fill="#475569" fontWeight="600" fontFamily="Inter">{labels[4]}</text>
              <text x={LP[5].x} y={LP[5].y} textAnchor="end" fontSize="13" fill="#475569" fontWeight="600" fontFamily="Inter">{labels[5]}</text>
            </svg>
          </div>
          <div style={{display:"flex",flexDirection:"column",flex:1,justifyContent:"center",marginLeft:36}}>
            <div style={{display:"flex",padding:"8px 0",borderBottom:"1px solid #f1f5f9"}}><div style={{display:"flex",width:120,fontSize:15,color:"#64748b",fontWeight:600}}>{sr[0].l}</div><div style={{display:"flex",fontSize:26,fontWeight:800,color:"#0f172a"}}>{sr[0].v}</div></div>
            <div style={{display:"flex",padding:"8px 0",borderBottom:"1px solid #f1f5f9"}}><div style={{display:"flex",width:120,fontSize:15,color:"#64748b",fontWeight:600}}>{sr[1].l}</div><div style={{display:"flex",fontSize:26,fontWeight:800,color:"#0f172a"}}>{sr[1].v}</div></div>
            <div style={{display:"flex",padding:"8px 0",borderBottom:"1px solid #f1f5f9"}}><div style={{display:"flex",width:120,fontSize:15,color:"#64748b",fontWeight:600}}>{sr[2].l}</div><div style={{display:"flex",fontSize:26,fontWeight:800,color:"#0f172a"}}>{sr[2].v}</div></div>
            <div style={{display:"flex",padding:"8px 0",borderBottom:"1px solid #f1f5f9"}}><div style={{display:"flex",width:120,fontSize:15,color:"#64748b",fontWeight:600}}>{sr[3].l}</div><div style={{display:"flex",fontSize:26,fontWeight:800,color:"#0f172a"}}>{sr[3].v}</div></div>
            <div style={{display:"flex",padding:"8px 0",borderBottom:"1px solid #f1f5f9"}}><div style={{display:"flex",width:120,fontSize:15,color:"#64748b",fontWeight:600}}>{sr[4].l}</div><div style={{display:"flex",fontSize:26,fontWeight:800,color:"#0f172a"}}>{sr[4].v}</div></div>
            <div style={{display:"flex",padding:"8px 0",borderBottom:"1px solid #f1f5f9"}}><div style={{display:"flex",width:120,fontSize:15,color:"#64748b",fontWeight:600}}>{sr[5].l}</div><div style={{display:"flex",fontSize:26,fontWeight:800,color:"#0f172a"}}>{sr[5].v}</div></div>
            <div style={{display:"flex",padding:"8px 0"}}><div style={{display:"flex",width:120,fontSize:15,color:"#64748b",fontWeight:600}}>{sr[6].l}</div><div style={{display:"flex",fontSize:26,fontWeight:800,color:"#0f172a"}}>{sr[6].v}</div></div>
          </div>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",padding:"10px 44px",borderTop:"1px solid #e2e8f0"}}>
          <div style={{display:"flex",fontSize:14,color:"#94a3b8",fontWeight:600}}>yardsperpass.com</div>
          <div style={{display:"flex",fontSize:12,color:"#cbd5e1"}}>Data: nflverse play-by-play</div>
        </div>
      </div>
    ),
    { ...size, fonts: [{ name: "Inter", data: fontData, style: "normal", weight: 800 }] }
  );
}
