"use client";
import {
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { englishCatalog } from "./portal-language-catalog";
import { GlobeIcon } from "../components/ControlIcons";
type Language = "hi" | "en";
const LanguageContext = createContext({
  language: "hi" as Language,
  setLanguage: (_value: Language) => {},
  translations: englishCatalog,
  provider: "local",
});
export function translatePortalText(
  value: string,
  translations = englishCatalog,
): string {
  const key = value.replace(/\s+/g, " ").trim().normalize("NFC");
  if (translations[key])
    return (
      (value.match(/^\s+/)?.[0] || "") +
      translations[key] +
      (value.match(/\s+$/)?.[0] || "")
    );
  const count = key.match(/^(\d+) (उपस्थिति रिकॉर्ड|कर्मी)$/);
  if (count)
    return `${count[1]} ${count[2] === "कर्मी" ? "staff" : "attendance records"}`;
  const detail = key.match(/^(.+) का विवरण$/);
  if (detail) return `Details for ${detail[1]}`;
  return value;
}
export function localizePortalContent(
  node: ReactNode,
  translations = englishCatalog,
): ReactNode {
  if (typeof node === "string") return translatePortalText(node, translations);
  if (Array.isArray(node))
    return node.map((child) => localizePortalContent(child, translations));
  if (!isValidElement(node)) return node;
  const element = node as ReactElement<Record<string, unknown>>;
  if (element.props.translate === "no") return element;
  const props: Record<string, unknown> = {};
  for (const key of ["aria-label", "title", "placeholder", "alt"])
    if (typeof element.props[key] === "string")
      props[key] = translatePortalText(
        element.props[key] as string,
        translations,
      );
  if (
    element.type === "option" &&
    element.props.value === undefined &&
    typeof element.props.children === "string"
  )
    props.value = element.props.children;
  if (element.props.children !== undefined)
    props.children = localizePortalContent(
      element.props.children as ReactNode,
      translations,
    );
  return cloneElement(element, props);
}
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>("hi");
  const [translations, setTranslations] = useState(englishCatalog);
  const [provider, setProvider] = useState("local");
  useEffect(() => {
    try {
      if (localStorage.getItem("araria-language") === "en") setLanguage("en");
    } catch {}
  }, []);
  useEffect(() => {
    document.documentElement.lang = language;
    try {
      localStorage.setItem("araria-language", language);
    } catch {}
  }, [language]);
  useEffect(() => {
    if (language !== "en") return;
    let active = true;
    void fetch("/api/translation")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (
          !active ||
          !data ||
          data.provider !== "google" ||
          typeof data.translations !== "object" ||
          !data.translations
        )
          return;
        const safe = { ...englishCatalog };
        for (const key of Object.keys(safe))
          if (
            typeof data.translations[key] === "string" &&
            data.translations[key].length <= 2000
          )
            safe[key] = data.translations[key];
        setTranslations(safe);
        setProvider("google");
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [language]);
  return (
    <LanguageContext.Provider
      value={{ language, setLanguage, translations, provider }}
    >
      {children}
    </LanguageContext.Provider>
  );
}
export function Localized({ children }: { children: ReactNode }) {
  const { language, translations } = useContext(LanguageContext);
  return (
    <>
      {language === "en"
        ? localizePortalContent(children, translations)
        : children}
    </>
  );
}
export function LanguageSwitcher() {
  const { language, setLanguage, provider } = useContext(LanguageContext);
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const label = language === "en" ? "Change language" : "भाषा बदलें";
  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return (
    <div
      className="sp-language"
      ref={container}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setOpen(false);
      }}
    >
      <button
        type="button"
        className="sp-button sp-secondary sp-language-toggle"
        ref={trigger}
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-controls="portal-language-options"
        onClick={() => setOpen((value) => !value)}
      >
        <GlobeIcon />
      </button>
      {open && (
        <div
          id="portal-language-options"
          className="sp-language-options"
          role="group"
          aria-label={label}
        >
          {(
            [
              ["hi", "हिन्दी"],
              ["en", "English"],
            ] as const
          ).map(([value, name]) => (
            <button
              key={value}
              type="button"
              translate="no"
              aria-pressed={language === value}
              onClick={() => {
                setLanguage(value);
                setOpen(false);
                trigger.current?.focus();
              }}
            >
              {name}
              <span aria-hidden="true">{language === value ? "✓" : ""}</span>
            </button>
          ))}
          {language === "en" && provider === "google" && (
            <small>Translated by Google</small>
          )}
        </div>
      )}
    </div>
  );
}
