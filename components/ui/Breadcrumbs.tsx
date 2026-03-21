import Link from "next/link";

interface BreadcrumbItem {
  label: string;
  href?: string; // if omitted, rendered as plain text (current page)
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
}

export default function Breadcrumbs({ items }: BreadcrumbsProps) {
  return (
    <nav aria-label="Breadcrumb" className="text-xs text-gray-400 mb-3">
      {items.map((item, i) => (
        <span key={i}>
          {i > 0 && <span className="mx-1.5">&gt;</span>}
          {item.href ? (
            <Link href={item.href} className="hover:text-gray-600 transition-colors">
              {item.label}
            </Link>
          ) : (
            <span>{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
