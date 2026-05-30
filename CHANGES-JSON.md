# ZMĚNY — JSON endpoint (květen 2026)

Nástroj nově tahá StoneX data z **JSON katalogu** místo z PDF. JSON má `part_number`
(= Shoptet CODE) a `gross_price` (hotová cena včetně DPH), takže odpadá hádání
přes názvy a dopočítávání z EUR.

## Jak to funguje

`/api/fetch-stonex` nově:
1. Primárně volá JSON endpoint `POST /api/client/catalog?metal_ids[]=N&misc[]=in_stock&page=P`
   pro všechny kovy (zlato/stříbro/platina/palladium) a všechny stránky.
2. Když JSON selže, spadne na původní PDF parser (fallback).

Párování: `part_number` == Shoptet `<CODE>` (přímé, spolehlivé).
Cena: `gross_price * (1 + supplier.marginPercent * marginCoef)`, kde `marginCoef`
default = 2/3 (sníží tvou přirážku o třetinu). DPH je už v `gross_price`.

## DŮLEŽITÉ: endpoint vyžaduje přihlášení (session)

Ověřeno: endpoint vrací data jen s platnou StoneX session. Bez ní `invalid_method`.
Proto je nutné nastavit env **`STONEX_COOKIE`**.

### Jak získat STONEX_COOKIE

1. Přihlas se na stonexbullion.com v prohlížeči.
2. F12 → Network → Fetch/XHR → načti katalog → klikni na request `catalog`.
3. Request Headers → zkopíruj celou hodnotu hlavičky `Cookie:`
   (hlavně `frontend_session=...` a `XSRF-TOKEN=...`).
4. Vlož do Railway Variables jako `STONEX_COOKIE`.

⚠️ Session vyprší (cookie má omezenou platnost, ~1 den). Když přecenění začne
vracet `invalid_method` / 0 produktů, obnov `STONEX_COOKIE`. Pro trvalý provoz
zvaž buď delší session, nebo automatický login (vyžaduje uložené přihlašovací údaje).

## Diagnostika

`GET /api/diag-stonex?password=APP_PASSWORD` vyzkouší metody proti StoneX a vrátí,
která zabrala a kolik produktů vidí — užitečné při ladění cookie/session.

## Pravidelnost

Tahle verze má ruční spuštění z frontendu. Pro automatický běh každou hodinu
přidej cron (např. balíček `node-cron`) volající interně logiku `/api/fetch-stonex`
→ `/api/compare` → `/api/generate-feed`, nebo nastav externí Railway cron job,
který trigne přecenění přes HTTP.
