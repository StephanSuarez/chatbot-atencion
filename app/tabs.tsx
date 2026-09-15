import s from "./tabs.module.css";

// Enlaces normales, no <Link>: con la navegación interna de Next el navegador no avisa de los
// cambios sin guardar de la configuración (FR-016).
export function Tabs({ active }: { active: "config" | "conocimiento" }) {
  return (
    <nav className={s.tabs} aria-label="Secciones">
      {[
        { href: "/", label: "Tu chatbot", key: "config" },
        { href: "/conocimiento", label: "Lo que sabe", key: "conocimiento" },
      ].map((tab) => (
        <a
          key={tab.key}
          href={tab.href}
          className={tab.key === active ? `${s.tab} ${s.on}` : s.tab}
          aria-current={tab.key === active ? "page" : undefined}
        >
          {tab.label}
        </a>
      ))}
    </nav>
  );
}
