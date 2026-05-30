# AUTOMATICKÉ PRAVIDELNÉ PŘECENĚNÍ (cron)

Appka teď umí běžet sama — bez klikání. V daný interval stáhne supplier XML,
stáhne StoneX katalog, spáruje, přecení a uloží feed na stálou URL.

## Co nastavit na Railway (Variables)

Povinné pro automatiku:
```
SHOPTET_SUPPLIER_FEED_URL = https://www.moje-zlato.cz/export/...   (URL tvého Shoptet exportu produktů)
STONEX_USER = tvůj StoneX email
STONEX_PASS = tvé StoneX heslo
APP_PASSWORD = heslo do appky
```

Volitelné (mají rozumné výchozí hodnoty):
```
CRON_SCHEDULE = 0 * * * *     (jak často; default každou hodinu)
ENABLE_CRON = true            (false = cron vypnout)
MARGIN_COIN = 1.5             (marže mince %)
MARGIN_BAR_SMALL = 2          (slitek do 1 oz %)
MARGIN_BAR_MID = 1            (slitek 1 oz–100 g %)
MARGIN_BAR_LARGE = 0.5        (slitek nad 100 g %)
```

## DŮLEŽITÉ: supplier XML musí jít z URL

Automatika nemůže čekat, až ručně nahraješ soubor. Proto musí mít
`SHOPTET_SUPPLIER_FEED_URL` — adresu tvého produktového exportu ze Shoptetu.
V Shoptetu: Propojení / Export → zkopíruj URL XML exportu produktů (celých 993,
ne výřez!) a vlož do Railway Variables.

## Stálá feed URL pro Shoptet

Po prvním běhu je přeceněný feed tady:
```
https://stonexdatafeed3-production-71ad.up.railway.app/output_feed.xml
```
Tuhle URL dáš v Shoptetu jako zdroj importu cen. Aktualizuje se sama při každém
cron běhu — nastav v Shoptetu import na stejný nebo delší interval.

## Plán (CRON_SCHEDULE) — příklady

- `0 * * * *` — každou hodinu (default)
- `*/30 * * * *` — každých 30 minut
- `0 8-20 * * *` — každou hodinu mezi 8:00 a 20:00
- `0 9,13,17 * * *` — v 9, 13 a 17 hodin
- `0 9 * * 1-5` — v 9:00 v pracovní dny

## Ověření, že automatika běží

- `GET /api/last-run` — ukáže poslední běh (kdy, kolik spárováno/přeceněno).
- `GET /api/run?password=APP_PASSWORD` — ručně spustí cyklus teď hned (test).
- V Railway → Deploy Logs uvidíš řádky `[CRON] ...` při každém běhu.

## Jak to běží uvnitř

1. Po startu appky se naplánuje cron dle `CRON_SCHEDULE`.
2. 5 s po startu proběhne první cyklus (ať je feed hned k dispozici).
3. Každý běh: supplier z URL → StoneX (auto-login) → párování → ceny → feed.
4. Feed se drží v paměti a servíruje na `/output_feed.xml`.

Pozn.: feed je v paměti — po restartu/redeployi appky se první feed vygeneruje
do ~5 s znovu. Pokud appka na Railway „usíná" při nečinnosti, cron může vynechat;
v Railway nastav, aby služba běžela trvale (sleepApplication=false — už máš).
