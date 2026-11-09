import Portal from "../components/Portal";
import { LanguageProvider } from "../lib/portal-language";
export default function Page() {
  return (
    <LanguageProvider>
      <Portal loginRole="staff" />
    </LanguageProvider>
  );
}
