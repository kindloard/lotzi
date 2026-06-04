import { Heart } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

type StorefrontFooterProps = {
  compact?: boolean;
};

export async function StorefrontFooter({ compact = false }: StorefrontFooterProps = {}) {
  const t = await getTranslations("marketplace.footer");

  return (
    <footer className="mt-auto bg-white">
      <div className={compact
        ? "mx-auto max-w-[1540px] px-6 pb-6 pt-8 sm:px-10 sm:pb-8 lg:px-12"
        : "mx-auto max-w-[1540px] px-6 pb-6 pt-16 sm:px-10 sm:pb-8 sm:pt-24 lg:px-12 lg:pt-32"
      }>
        {!compact ? (
          <div className="mb-16 sm:mb-24">
            <h2 className="text-5xl font-black leading-[1.1] tracking-tight text-slate-200/80 sm:text-7xl lg:text-[110px]">
              Shop your city, <br />
              from your couch <Heart className="inline-block text-brand fill-brand align-baseline size-[0.8em]" />
            </h2>
          </div>
        ) : null}

        <div className="flex flex-col gap-4 border-t border-slate-100 pt-6 text-[13px] font-bold text-[#111827] sm:flex-row-reverse sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-4 sm:gap-6">
            <Link href="#terms" className="transition-colors hover:opacity-80">
              {t("legal.terms")}
            </Link>
            <Link href="#privacy" className="transition-colors hover:opacity-80">
              {t("legal.privacy")}
            </Link>
            <Link href="#contact" className="transition-colors hover:opacity-80">
              {t("contact.title")}
            </Link>
          </div>
          <div>
            <span>{t("copyright")}</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
