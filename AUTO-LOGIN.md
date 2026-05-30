# AUTO-LOGIN — nastavení (žádné ruční cookie!)

Appka se teď přihlašuje na StoneX sama. Zadáš jen přihlašovací údaje, o session
(cookie) se stará appka — i o obnovu, když vyprší.

## Co nastavit na Railway

Railway → tvůj projekt → service → **Variables** → přidej dvě proměnné:

```
STONEX_USER = tvůj StoneX přihlašovací email
STONEX_PASS = tvé StoneX heslo
```

A `APP_PASSWORD` (heslo do téhle appky) už bys měla mít. Ulož → Railway restartuje.

To je všechno. Žádné kopírování cookie z DevTools.

## Ověření, že login funguje

Otevři v prohlížeči:
```
https://tvoje-railway-url/api/diag-login?password=APP_PASSWORD
```

- `{ "ok": true, "loggedInAt": "...", "cookies": ["XSRF-TOKEN","frontend_session",...] }`
  → login funguje, hotovo. Můžeš pustit přecenění.
- `{ "ok": false, "error": "..." }`
  → login nezabral. Nejčastější příčina: StoneX používá jiný login endpoint,
  než appka zkouší. V tom případě mi pošli (z přihlášeného prohlížeče, DevTools →
  Network → při přihlašování) ten **login request** (Copy as cURL) a doladím
  přesný endpoint. Stačí jednou.

## Jak to funguje uvnitř

1. Při prvním stažení katalogu se appka přihlásí (GET login → CSRF token →
   POST údaje → session cookies).
2. Session drží v paměti a používá pro katalog.
3. Když katalog vrátí chybu (vypršelá session), appka se **sama přihlásí znovu**
   a zopakuje — bez tvého zásahu.

## Záloha: ruční cookie

Pokud auto-login z nějakého důvodu nepůjde, pořád funguje ruční režim:
nastav `STONEX_COOKIE` místo USER/PASS (návod v CHANGES-JSON.md). Appka dá
přednost USER/PASS, když jsou vyplněné; jinak použije STONEX_COOKIE.

## Login endpoint — pokud diag-login selže

Appka zkouší tyto (běžné Laravel varianty):
- POST /api/client/login
- POST /api/client/auth/login
- POST /en/login/
- POST /login

Když StoneX používá jiný, je to jediná věc k doplnění — pošli mi login request
a přidám správnou adresu do seznamu.
