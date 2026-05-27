import { Command, Download, LockKeyhole, PackagePlus } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { navItems } from "../../config/navigation";
import type { NavId } from "../../types/dashboard";

export function CommandPalette({
  onClose,
  onNavigate,
  onNewProduct
}: {
  onClose: () => void;
  onNavigate: (nav: NavId) => void;
  onNewProduct: () => void;
}) {
  const t = useTranslations("dashboard");
  const [query, setQuery] = useState("");
  const actions = [
    ...navItems.map((item) => ({
      id: item.id,
      label: t("command.open", { label: t(item.labelKey as never) }),
      icon: item.icon,
      action: () => { onNavigate(item.id); onClose(); }
    })),
    { id: "new-product", label: t("command.createProduct"), icon: PackagePlus, action: onNewProduct },
    { id: "export-orders", label: t("command.exportOrders"), icon: Download, action: onClose },
    { id: "security", label: t("command.openSecuritySettings"), icon: LockKeyhole, action: () => { onNavigate("settings"); onClose(); } }
  ];
  const visible = actions.filter((item) => item.label.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-zinc-950/40 px-4 pt-[12dvh] backdrop-blur-sm">
      <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl">
        <div className="flex items-center gap-3 border-b border-zinc-200 px-4 py-3">
          <Command className="text-zinc-400" size={16} />
          <input
            autoFocus
            className="h-10 min-w-0 flex-1 bg-transparent text-[13px] font-normal text-zinc-950 outline-none placeholder:text-zinc-400"
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("command.placeholder")}
            value={query}
          />
          <button className="rounded-lg border border-zinc-200 px-2 py-1 text-[10px] font-medium text-zinc-500 hover:border-zinc-300" onClick={onClose} type="button">
            {t("command.escape")}
          </button>
        </div>
        <div className="max-h-[360px] overflow-y-auto p-2 custom-scrollbar">
          {visible.length > 0 ? visible.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className="flex h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-[13px] font-medium text-zinc-700 transition hover:bg-zinc-50 hover:text-zinc-950"
                key={item.id}
                onClick={item.action}
                type="button"
              >
                <Icon size={15} className="text-zinc-400" />
                {item.label}
              </button>
            );
          }) : (
            <p className="p-4 text-center text-xs font-normal text-zinc-400">{t("command.noCommands")}</p>
          )}
        </div>
      </div>
    </div>
  );
}

