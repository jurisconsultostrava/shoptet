# DOPOČET ZE SPOTU + POJISTKA PROTI PRODEJI POD NÁKUPEM

## Co to řeší

Produkty, které StoneX zrovna nemá skladem (filtr in_stock je vyřadí), se
nespárují → dřív jim zůstala stará cena, klidně i pod aktuálním nákupem.
Nově se u nich cena dopočítá ze spotu zlata + prémie, a navíc je pojistka,
která nikdy nepustí prodejní cenu pod nákup.

## Jak to funguje

1. **Spárované produkty**: cena z StoneX gross_price × (1 + marže dle pásma).
   Pojistka: když by prodejní cena byla pod StoneX nákupem, zvedne se na nákup +0,5 %.

2. **Nespárované zlaté produkty** (StoneX je nemá skladem):
   - Spot zlata z GoldAPI (Kč/g) × hmotnost × ryzost (0,9999)
   - + prémie na gram (průměr ze spárovaných StoneX produktů stejného pásma)
   - = odhad nákupní ceny
   - × (1 + marže dle pásma) = prodejní cena
   - Pojistka: ne pod starou nákupkou ze supplier XML.

3. Nezlaté nespárované (stříbro/platina) se zatím nedopočítávají — zůstanou beze změny.

## Co nastavit na Railway

```
GOLDAPI_TOKEN = goldapi-...    (token z goldapi.io pro XAU/CZK)
```
Ostatní (STONEX_USER/PASS, SHOPTET_SUPPLIER_FEED_URL, marže) už máš.

## Kontrola po běhu

`GET /api/last-run` nově ukazuje:
- `spotPriced` — kolik nespárovaných se docenilo ze spotu
- `belowCostFixed` — kolik cen pojistka zvedla nad nákup
- `spot` — použitý spot zlata (Kč/g)

Když `belowCostFixed > 0`, znamená to, že pojistka zabránila prodeji pod cenou
— dobře, ale mrkni na ty produkty, jestli marže dává smysl.

## Důležité

Prémie u nespárovaných je ODHAD (průměr ze stejného hmotnostního pásma), ne
přesná hodnota od StoneX. U běžných slitků (1oz, 100g) je prémie stabilní, takže
odhad sedí. U sběratelských mincí se prémie hodně liší — tam je odhad méně přesný,
proto pojistka proti podstřelení.

Spot se cachuje 10 minut (šetří GoldAPI limit). GoldAPI free tier má omezený
počet volání/měsíc — při cronu každou hodinu to vyjde ~720 volání/měsíc, hlídej limit.
