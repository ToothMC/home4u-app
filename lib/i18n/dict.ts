import type { SupportedLang } from "@/lib/lang/preferred-language";

export const DEFAULT_LANG: SupportedLang = "de";

// Flache Key-basierte Wörterbücher. `de` ist die kanonische Liste — alle
// anderen Sprachen müssen exakt dieselben Keys haben (vom TS-Compiler erzwungen).
const de = {
  "nav.search": "Suchen",
  "nav.rentOut": "Vermieten",
  "nav.sell": "Verkaufen",
  "nav.wantedAds": "Such-Inserate",
  "nav.forAgents": "Für Makler",
  "nav.scamCheck": "Scam-Check",
  "nav.favorites": "Meine Favoriten",

  "hero.title.line1": "Hier finde ich",
  "hero.title.line2.prefix": "mein",
  "hero.title.line2.accent": "Zuhause.",
  "hero.subtitle":
    "Home4U verbindet dich mit passenden Immobilien — persönlich, einfach und modern.",
  "hero.cta.search": "Jetzt suchen",
  "hero.cta.check": "Inserat prüfen",
  "hero.image.alt": "Moderne Villa-Terrasse mit Meerblick",

  "why.heading": "Warum Home4U?",

  "why.match.badge": "92 % Match",
  "why.match.title": "Kein endloses Suchen",
  "why.match.text":
    "Kein stundenlanges Scrollen durch Social-Media-Gruppen und Inserate-Portale. Unsere KI-Technologie und unser Netzwerk zeigen dir nur Immobilien, die wirklich zu dir passen.",

  "why.scam.badge": "Kein Scam",
  "why.scam.title": "Keine Scam-Anzeige",
  "why.scam.text":
    "Kennst du das? „Dieses schöne Haus ist leider weg, aber ich habe noch andere Objekte.“ Bei uns findest du nur echte, geprüfte Inserate.",

  "why.price.badge": "Sehr guter Preis",
  "why.price.aria": "Sehr guter Preis",
  "why.price.title": "Aktuelle Marktpreis-Bewertung",
  "why.price.text":
    "Von „sehr guter Preis“ bis „sehr hoher Preis“ – ist die Miete wirklich angemessen? Wir zeigen dir, wie sich der Preis im Vergleich zu ähnlichen Objekten in der Gegend schlägt.",

  "why.anon.badge": "100 % anonym",
  "why.anon.title": "Gefunden werden — statt zu suchen",
  "why.anon.text":
    "Eigenes Such-Inserat aufgeben wie früher in der Zeitung: „Junges Paar sucht 3-Zimmer Villa mit Pool im Raum Paphos.“ Makler mit passenden Angeboten dürfen Kontakt aufnehmen — ohne Preisgabe deiner Email-Adresse.",
  "why.anon.cta": "Such-Inserate ansehen →",

  "paths.heading": "Vier Wege zu Home4U",
  "common.loading": "Lädt…",

  "closing.heading": "Bereit, dein Zuhause zu finden?",
  "closing.text":
    "Lass uns gemeinsam den richtigen Ort für dich finden. Persönlich. Einfach. Home4U.",
  "closing.image.alt": "Paar auf Terrasse beim Sonnenuntergang",

  "footer.tagline": "Dein Zuhause auf Zypern",
  "footer.fourPaths": "Vier Wege",

  "lang.label": "Sprache",
  "lang.choose": "Sprache wählen",
} as const;

export type TKey = keyof typeof de;
type Dict = Record<TKey, string>;

const en: Dict = {
  "nav.search": "Search",
  "nav.rentOut": "Rent out",
  "nav.sell": "Sell",
  "nav.wantedAds": "Wanted ads",
  "nav.forAgents": "For agents",
  "nav.scamCheck": "Scam check",
  "nav.favorites": "My favourites",

  "hero.title.line1": "Here I find",
  "hero.title.line2.prefix": "my",
  "hero.title.line2.accent": "home.",
  "hero.subtitle":
    "Home4U connects you with the right properties — personal, simple and modern.",
  "hero.cta.search": "Search now",
  "hero.cta.check": "Verify a listing",
  "hero.image.alt": "Modern villa terrace with sea view",

  "why.heading": "Why Home4U?",

  "why.match.badge": "92% match",
  "why.match.title": "No endless searching",
  "why.match.text":
    "No more hours of scrolling through social-media groups and listing portals. Our AI technology and our network only show you properties that truly fit you.",

  "why.scam.badge": "No scam",
  "why.scam.title": "No scam listings",
  "why.scam.text":
    "Sound familiar? “Unfortunately this nice house is gone, but I have other properties.” With us you only find real, verified listings.",

  "why.price.badge": "Great price",
  "why.price.aria": "Great price",
  "why.price.title": "Current market-price rating",
  "why.price.text":
    "From “great price” to “very high price” — is the rent really fair? We show you how the price compares to similar properties in the area.",

  "why.anon.badge": "100% anonymous",
  "why.anon.title": "Be found — instead of searching",
  "why.anon.text":
    "Post your own wanted ad like in the old newspaper days: “Young couple looking for a 3-bedroom villa with pool in the Paphos area.” Agents with matching offers may contact you — without revealing your email address.",
  "why.anon.cta": "View wanted ads →",

  "paths.heading": "Four ways to Home4U",
  "common.loading": "Loading…",

  "closing.heading": "Ready to find your home?",
  "closing.text":
    "Let’s find the right place for you, together. Personal. Simple. Home4U.",
  "closing.image.alt": "Couple on a terrace at sunset",

  "footer.tagline": "Your home in Cyprus",
  "footer.fourPaths": "Four ways",

  "lang.label": "Language",
  "lang.choose": "Choose language",
};

const ru: Dict = {
  "nav.search": "Поиск",
  "nav.rentOut": "Сдать",
  "nav.sell": "Продать",
  "nav.wantedAds": "Объявления о поиске",
  "nav.forAgents": "Для агентов",
  "nav.scamCheck": "Проверка на мошенничество",
  "nav.favorites": "Избранное",

  "hero.title.line1": "Здесь я нахожу",
  "hero.title.line2.prefix": "свой",
  "hero.title.line2.accent": "дом.",
  "hero.subtitle":
    "Home4U соединяет вас с подходящей недвижимостью — лично, просто и современно.",
  "hero.cta.search": "Начать поиск",
  "hero.cta.check": "Проверить объявление",
  "hero.image.alt": "Современная терраса виллы с видом на море",

  "why.heading": "Почему Home4U?",

  "why.match.badge": "92 % совпадение",
  "why.match.title": "Без бесконечного поиска",
  "why.match.text":
    "Никакой многочасовой прокрутки соцсетей и порталов объявлений. Наши ИИ-технологии и наша сеть показывают только те объекты, которые действительно вам подходят.",

  "why.scam.badge": "Без обмана",
  "why.scam.title": "Никаких поддельных объявлений",
  "why.scam.text":
    "Знакомо? «К сожалению, этот красивый дом уже сдан, но у меня есть другие объекты». У нас вы найдёте только настоящие, проверенные объявления.",

  "why.price.badge": "Очень хорошая цена",
  "why.price.aria": "Очень хорошая цена",
  "why.price.title": "Актуальная оценка рыночной цены",
  "why.price.text":
    "От «очень хорошей цены» до «очень высокой цены» — действительно ли арендная плата справедлива? Мы покажем, как цена соотносится с похожими объектами в этом районе.",

  "why.anon.badge": "100 % анонимно",
  "why.anon.title": "Чтобы нашли вас — а не вы искали",
  "why.anon.text":
    "Подайте собственное объявление о поиске, как раньше в газете: «Молодая пара ищет виллу с тремя спальнями и бассейном в районе Пафоса». Агенты с подходящими предложениями могут связаться с вами — без раскрытия вашего email-адреса.",
  "why.anon.cta": "Смотреть объявления о поиске →",

  "paths.heading": "Четыре пути к Home4U",
  "common.loading": "Загрузка…",

  "closing.heading": "Готовы найти свой дом?",
  "closing.text":
    "Давайте вместе найдём подходящее место для вас. Лично. Просто. Home4U.",
  "closing.image.alt": "Пара на террасе на закате",

  "footer.tagline": "Ваш дом на Кипре",
  "footer.fourPaths": "Четыре пути",

  "lang.label": "Язык",
  "lang.choose": "Выбрать язык",
};

const el: Dict = {
  "nav.search": "Αναζήτηση",
  "nav.rentOut": "Ενοικίαση",
  "nav.sell": "Πώληση",
  "nav.wantedAds": "Αγγελίες αναζήτησης",
  "nav.forAgents": "Για μεσίτες",
  "nav.scamCheck": "Έλεγχος απάτης",
  "nav.favorites": "Αγαπημένα",

  "hero.title.line1": "Εδώ βρίσκω",
  "hero.title.line2.prefix": "το",
  "hero.title.line2.accent": "σπίτι μου.",
  "hero.subtitle":
    "Το Home4U σας συνδέει με τα σωστά ακίνητα — προσωπικά, απλά και σύγχρονα.",
  "hero.cta.search": "Ξεκινήστε την αναζήτηση",
  "hero.cta.check": "Έλεγχος αγγελίας",
  "hero.image.alt": "Σύγχρονη βεράντα βίλας με θέα στη θάλασσα",

  "why.heading": "Γιατί Home4U;",

  "why.match.badge": "92 % ταίριασμα",
  "why.match.title": "Όχι ατελείωτη αναζήτηση",
  "why.match.text":
    "Όχι πια ώρες κύλισης σε ομάδες κοινωνικών μέσων και πύλες αγγελιών. Η τεχνολογία AI και το δίκτυό μας σάς δείχνουν μόνο ακίνητα που σας ταιριάζουν πραγματικά.",

  "why.scam.badge": "Καμία απάτη",
  "why.scam.title": "Καμία απατηλή αγγελία",
  "why.scam.text":
    "Σας φαίνεται οικείο; «Δυστυχώς αυτό το ωραίο σπίτι έχει νοικιαστεί, αλλά έχω άλλα ακίνητα.» Σε εμάς θα βρείτε μόνο αληθινές, ελεγμένες αγγελίες.",

  "why.price.badge": "Πολύ καλή τιμή",
  "why.price.aria": "Πολύ καλή τιμή",
  "why.price.title": "Τρέχουσα αποτίμηση τιμής αγοράς",
  "why.price.text":
    "Από «πολύ καλή τιμή» έως «πολύ υψηλή τιμή» — είναι όντως δίκαιο το ενοίκιο; Σας δείχνουμε πώς συγκρίνεται η τιμή με παρόμοια ακίνητα στην περιοχή.",

  "why.anon.badge": "100 % ανώνυμα",
  "why.anon.title": "Να σας βρουν — αντί να ψάχνετε",
  "why.anon.text":
    "Δημοσιεύστε τη δική σας αγγελία αναζήτησης όπως παλιά στην εφημερίδα: «Νεαρό ζευγάρι ψάχνει βίλα 3 υπνοδωματίων με πισίνα στην περιοχή της Πάφου.» Μεσίτες με σχετικές προσφορές μπορούν να επικοινωνήσουν — χωρίς να αποκαλύψετε τη διεύθυνση email σας.",
  "why.anon.cta": "Δείτε τις αγγελίες αναζήτησης →",

  "paths.heading": "Τέσσερις τρόποι για το Home4U",
  "common.loading": "Φόρτωση…",

  "closing.heading": "Έτοιμοι να βρείτε το σπίτι σας;",
  "closing.text":
    "Ας βρούμε μαζί το σωστό μέρος για εσάς. Προσωπικά. Απλά. Home4U.",
  "closing.image.alt": "Ζευγάρι σε βεράντα στο ηλιοβασίλεμα",

  "footer.tagline": "Το σπίτι σας στην Κύπρο",
  "footer.fourPaths": "Τέσσερις τρόποι",

  "lang.label": "Γλώσσα",
  "lang.choose": "Επιλογή γλώσσας",
};

export const dict: Record<SupportedLang, Dict> = { de, en, ru, el };

export function makeT(lang: SupportedLang) {
  const map = dict[lang] ?? dict[DEFAULT_LANG];
  return (key: TKey): string => map[key] ?? dict[DEFAULT_LANG][key];
}

export type T = ReturnType<typeof makeT>;
