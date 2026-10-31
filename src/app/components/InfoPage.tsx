import type { ReactNode } from "react";
import { shop, whatsappLink } from "../config/shop";

export const DRAFT_NOTICE = "This page is a draft and is being reviewed.";

export interface InfoSection {
  title: string;
  body: ReactNode;
}

/** Marks a fact the owner has not supplied yet. Never replace it with a guess. */
export function ToBeConfirmed() {
  return <span className="text-ink">To be confirmed</span>;
}

/** Contact details, taken only from config/shop.ts. */
export function ContactDetails() {
  return (
    <ul className="border-t border-b10">
      <li className="flex flex-col gap-1 border-b border-b10 py-3 sm:flex-row sm:gap-6">
        <span className="micro text-b60 sm:w-24">Email</span>
        <a href={`mailto:${shop.email}`} className="break-all text-sm text-ink transition-colors hover:text-b60">
          {shop.email}
        </a>
      </li>
      <li className="flex flex-col gap-1 border-b border-b10 py-3 sm:flex-row sm:gap-6">
        <span className="micro text-b60 sm:w-24">WhatsApp</span>
        <a
          href={whatsappLink()}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-ink transition-colors hover:text-b60"
        >
          {shop.phone}
        </a>
      </li>
    </ul>
  );
}

/** A ruled list with one item per row. */
export function InfoList({ items }: { items: ReactNode[] }) {
  return (
    <ul className="border-t border-b10">
      {items.map((item, idx) => (
        <li key={idx} className="border-b border-b10 py-3 text-b60">
          {item}
        </li>
      ))}
    </ul>
  );
}

interface InfoPageProps {
  eyebrow: string;
  title: string;
  intro?: string;
  sections: InfoSection[];
}

export function InfoPage({ eyebrow, title, intro, sections }: InfoPageProps) {
  return (
    <div className="min-h-screen bg-paper">
      <div className="mx-auto max-w-[1360px] px-4 py-16 sm:px-6">
        <header className="mb-4 border-b border-b10 pb-12">
          <p className="page-kicker micro mb-6 text-b60">{eyebrow}</p>
          <h1 className="display h-sec mb-8 break-words">{title}</h1>
          {intro && <p className="max-w-2xl text-lg text-b60 md:text-xl">{intro}</p>}
          <p role="note" className="mt-8 max-w-2xl border border-brand px-4 py-3 text-ink r-card">
            <span className="micro mr-3 text-brand">Draft</span>
            {DRAFT_NOTICE}
          </p>
        </header>

        {sections.map((section, idx) => (
          <section
            key={section.title}
            className="grid gap-8 border-b border-b10 py-12 md:grid-cols-[1fr_2fr] md:gap-16"
          >
            <div>
              <span className="text-sm text-brand">{String(idx + 1).padStart(2, "0")}</span>
              <h2 className="display h-mid mt-6 break-words">{section.title}</h2>
            </div>
            <div className="min-w-0 space-y-4 leading-relaxed text-b60">{section.body}</div>
          </section>
        ))}
      </div>
    </div>
  );
}
