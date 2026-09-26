/**
 * Country profiles. One codebase, one deployment per country: the active
 * profile is picked at build time by NEXT_PUBLIC_COUNTRY (see ./country.ts).
 *
 * Mirrors COUNTRIES in country_config.py on the pipeline side: the national
 * slug, carrier keys and locale must match what the Python scripts write into
 * public/data. Adding a country = a profile here, a profile there, and the
 * fetchers for any carrier that is not in the shared catalogue yet
 * (lib/carriers.ts). See docs/NEW_COUNTRY.md.
 */

export interface CountryProfile {
  code: string;
  name: string;
  /** BCP 47 tag for number and date formatting. */
  locale: string;
  htmlLang: string;
  ogLocale: string;
  /** UI string dictionary, see lib/strings.ts. */
  language: 'nl' | 'it';

  siteName: string;
  siteUrl: string;
  githubUrl: string;
  sisterSites: { label: string; url: string }[];

  /** Slug of the national overview file and its row in municipalities.json. */
  nationalSlug: string;
  /** URL alias that also selects the national view (?gemeente=<alias>). */
  nationalUrlAlias: string;
  nationalLabel: string;
  /** Short name in running text, e.g. "Heel België". */
  nationalShortLabel: string;

  defaultMunicipalitySlug: string;
  defaultCenter: [number, number];
  defaultZoom: number;

  regionLabel: string;
  regionLabelPlural: string;
  /** Name of the official municipality code (NIS in Belgium, ISTAT in Italy). */
  municipalityCodeLabel: string;
  municipalityCodeExample: string;

  /** Metric projection the pipeline computes areas and buffers in (country_config METRIC_CRS). */
  metricCrsLabel: string;

  /** ISO 3166-1 alpha-2, lower case, to filter geocoder results. */
  geocoderCountryCodes: string;
  /** [minLon, minLat, maxLon, maxLat], biases address search to the country. */
  bbox: [number, number, number, number];

  /**
   * Carriers shown, in fixed order (roughly by network size). The order picks
   * each carrier's series colour, so do not sort it at runtime.
   */
  carriers: readonly string[];

  /** Amazon storefront whose pickup-point finder (/ulp) is scraped. */
  amazonDomain: string;

  /** Networks we could not include, shown in About. */
  missingCarriers: { name: string; reason: string }[];

  /** Links in the About modal's links tab. */
  aboutLinks: { title: string; description: string; url: string }[];
}

export const COUNTRIES: Record<string, CountryProfile> = {
  BE: {
    code: 'BE',
    name: 'België',
    locale: 'nl-BE',
    htmlLang: 'nl-BE',
    ogLocale: 'nl_BE',
    language: 'nl',

    siteName: 'Pakketpunten België',
    siteUrl: 'https://parcels-belgium.vercel.app',
    githubUrl: 'https://github.com/robbertj85/parcels-belgium',
    sisterSites: [{ label: 'Pakketpunten Nederland', url: 'https://pakketpuntenviewer.nl' }],

    nationalSlug: 'belgie',
    nationalUrlAlias: 'alle-gemeenten',
    nationalLabel: 'België (totaal)',
    nationalShortLabel: 'België',

    defaultMunicipalitySlug: 'gent',
    defaultCenter: [51.0543, 3.7174],
    defaultZoom: 12,

    regionLabel: 'provincie',
    regionLabelPlural: 'provincies',
    municipalityCodeLabel: 'NIS',
    municipalityCodeExample: '44021',

    metricCrsLabel: 'Belgian Lambert 2008 (EPSG:3812)',
    geocoderCountryCodes: 'be',
    bbox: [2.54, 49.49, 6.41, 51.51],

    carriers: ['bpost', 'DHL', 'GLS', 'InPost', 'VintedGo', 'PostNL', 'DPD', 'Amazon', 'ViaTim', 'FedEx'],
    amazonDomain: 'www.amazon.com.be',

    missingCarriers: [
      { name: 'UPS Access Point', reason: 'De locator-API vereist een ontwikkelaarsaccount (OAuth); de website laadt alles via JavaScript.' },
      { name: 'Budbee', reason: 'Geen publieke locatiezoeker, niet in de DPD-data en vrijwel niet in OpenStreetMap.' },
      { name: 'Mondial Relay', reason: 'De eigen API vereist handelaarsgegevens. De Belgische Mondial Relay-punten zijn overgegaan naar InPost en staan daar.' },
      { name: 'Cubee', reason: 'Geen eigen publieke API. Cubee-kluizen die bpost of GLS bedienen, staan onder die vervoerders.' },
      { name: 'DHL Express', reason: 'Vereist een API-sleutel en overlapt grotendeels met DHL Parcel (bpost-netwerk).' },
      { name: 'De Buren', reason: 'Slechts enkele Belgische locaties, niet betrouwbaar per gemeente te koppelen.' },
    ],

    aboutLinks: [
      {
        title: 'BIPT - Postmarkt',
        description: 'Het Belgisch Instituut voor Postdiensten en Telecommunicatie publiceert jaarlijks cijfers over de pakjesmarkt.',
        url: 'https://www.bipt.be/consumenten/post',
      },
      {
        title: 'Statbel - Bevolking per gemeente',
        description: 'Officiële bevolkingscijfers per gemeente, gebruikt voor de dichtheidsstatistieken.',
        url: 'https://statbel.fgov.be/nl/themas/bevolking/structuur-van-de-bevolking',
      },
    ],
  },

  IT: {
    code: 'IT',
    name: 'Italia',
    locale: 'it-IT',
    htmlLang: 'it',
    ogLocale: 'it_IT',
    language: 'it',

    siteName: 'Punti di ritiro Italia',
    siteUrl: 'https://parcels-italy.vercel.app',
    githubUrl: 'https://github.com/robbertj85/parcels-italy',
    sisterSites: [
      { label: 'Pakketpunten Nederland', url: 'https://pakketpuntenviewer.nl' },
      { label: 'Pakketpunten België', url: 'https://parcels-belgium.vercel.app' },
    ],

    nationalSlug: 'italia',
    nationalUrlAlias: 'tutti-i-comuni',
    nationalLabel: 'Italia (totale)',
    nationalShortLabel: 'Italia',

    defaultMunicipalitySlug: 'milano',
    defaultCenter: [45.4642, 9.19],
    defaultZoom: 12,

    regionLabel: 'regione',
    regionLabelPlural: 'regioni',
    municipalityCodeLabel: 'ISTAT',
    municipalityCodeExample: '015146',

    metricCrsLabel: 'RDN2008 / Italy zone (EPSG:6875)',
    geocoderCountryCodes: 'it',
    bbox: [6.62, 35.49, 18.52, 47.09],

    carriers: ['PosteItaliane', 'DPD', 'InPost', 'GLS', 'DHL', 'Amazon'],
    amazonDomain: 'www.amazon.it',

    missingCarriers: [
      { name: 'UPS Access Point', reason: 'API con account sviluppatore (OAuth).' },
      { name: 'Mail Boxes Etc.', reason: 'Centri di spedizione (~550), non una rete di ritiro; non inclusi.' },
      { name: 'Esselunga Locker', reason: 'Solo per gli ordini online di Esselunga, non per pacchi di altri corrieri.' },
      { name: 'Kipoint, SDA, Mondial Relay', reason: 'Inclusi tramite altre reti: Kipoint e SDA in Poste Italiane, Mondial Relay in InPost.' },
      { name: 'Vinted Go', reason: 'Non attivo in Italia.' },
    ],

    aboutLinks: [],
  },
};
