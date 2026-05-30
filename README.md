# StoneX → Shoptet Feed Tool

Internal admin tool for comparing StoneX Bullion catalog prices with Shoptet supplier XML products and generating an updated Shoptet XML import.

## Core workflow

1. Load `productsSupplier.xml` from file upload or from `SHOPTET_SUPPLIER_FEED_URL`.
2. Fetch a StoneX catalog/search page.
3. Open each StoneX detail page and extract Product number, price, availability and product parameters.
4. Match products by:

```text
StoneX Product number = Shoptet CODE
```

5. Review and manually edit proposed changes in the browser.
6. Generate updated Shoptet supplier XML.

## Railway deployment

Create a Railway service from this GitHub repository and set the variables below.

### Required / recommended variables

```env
APP_PASSWORD=change-me
SHOPTET_SUPPLIER_FEED_URL=https://www.moje-zlato.cz/export/productsSupplier.xml?patternId=-4&partnerId=13&hash=...
DEFAULT_EUR_CZK=24.335
DEFAULT_MARGIN_CZK=1200
DEFAULT_MARGIN_PERCENT=0
DEFAULT_WAREHOUSE=DE/CH
DEFAULT_IN_STOCK_TEXT=Externí sklad / DE
DEFAULT_OUT_OF_STOCK_TEXT=Předobjednávka / Fixace ceny
USER_AGENT=Mozilla/5.0 moje-zlato-price-tool
```

Do not commit real secrets or production feed hashes into GitHub. Put them only into Railway Variables.

## Local development

```bash
npm install
cp .env.example .env
npm run dev
```

Then open:

```text
http://localhost:3000
```

## Notes

- The app edits XML by `CODE` and preserves the original product blocks as much as possible.
- By default it proposes updating `PURCHASE_PRICE`; updating `PRICE` must be confirmed via the table/export data.
- StoneX is treated as a reference source. Do not run fully automated repricing without manual review.
- External StoneX availability should not be treated as local CZ stock.
