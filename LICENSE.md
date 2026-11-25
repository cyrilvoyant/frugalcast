# FrugalCast licence

Copyright (c) 2026 Cyril Voyant, Mines Paris – PSL.

FrugalCast is free for research, teaching and any other **non-commercial** use, provided you cite it:

> Voyant, C. (2026). FrugalCast: a browser benchmark of frugal forecasting models with prediction intervals (Version 1.2.0) [Software]. Mines Paris – PSL. https://doi.org/10.5281/zenodo.24197717

## Code

The code (`engine.js`, `app.js`, `worker.js`, `kalpha.js`, `papers.js`, `style.css`, `index.html`) is under the **PolyForm Noncommercial License 1.0.0**: https://polyformproject.org/licenses/noncommercial/1.0.0/

Required Notice: Copyright (c) 2026 Cyril Voyant (https://www.cyrilvoyant.com)

Full text of the licence, unchanged:

## PolyForm Noncommercial License 1.0.0

<https://polyformproject.org/licenses/noncommercial/1.0.0>

### Acceptance

In order to get any license under these terms, you must agree to them as both strict obligations and conditions to all your licenses.

### Copyright License

The licensor grants you a copyright license for the software to do everything you might do with the software that would otherwise infringe the licensor's copyright in it for any permitted purpose.  However, you may only distribute the software according to [Distribution License](#distribution-license) and make changes or new works based on the software according to [Changes and New Works License](#changes-and-new-works-license).

### Distribution License

The licensor grants you an additional copyright license to distribute copies of the software.  Your license to distribute covers distributing the software with changes and new works permitted by [Changes and New Works License](#changes-and-new-works-license).

### Notices

You must ensure that anyone who gets a copy of any part of the software from you also gets a copy of these terms or the URL for them above, as well as copies of any plain-text lines beginning with `Required Notice:` that the licensor provided with the software.  For example:

> Required Notice: Copyright Yoyodyne, Inc. (http://example.com)

### Changes and New Works License

The licensor grants you an additional copyright license to make changes and new works based on the software for any permitted purpose.

### Patent License

The licensor grants you a patent license for the software that covers patent claims the licensor can license, or becomes able to license, that you would infringe by using the software.

### Noncommercial Purposes

Any noncommercial purpose is a permitted purpose.

### Personal Uses

Personal use for research, experiment, and testing for the benefit of public knowledge, personal study, private entertainment, hobby projects, amateur pursuits, or religious observance, without any anticipated commercial application, is use for a permitted purpose.

### Noncommercial Organizations

Use by any charitable organization, educational institution, public research organization, public safety or health organization, environmental protection organization, or government institution is use for a permitted purpose regardless of the source of funding or obligations resulting from the funding.

### Fair Use

You may have "fair use" rights for the software under the law. These terms do not limit them.

### No Other Rights

These terms do not allow you to sublicense or transfer any of your licenses to anyone else, or prevent the licensor from granting licenses to anyone else.  These terms do not imply any other licenses.

### Patent Defense

If you make any written claim that the software infringes or contributes to infringement of any patent, your patent license for the software granted under these terms ends immediately. If your company makes such a claim, your patent license ends immediately for work on behalf of your company.

### Violations

The first time you are notified in writing that you have violated any of these terms, or done anything with the software not covered by your licenses, your licenses can nonetheless continue if you come into full compliance with these terms, and take practical steps to correct past violations, within 32 days of receiving notice.  Otherwise, all your licenses end immediately.

### No Liability

***As far as the law allows, the software comes as is, without any warranty or condition, and the licensor will not be liable to you for any damages arising out of these terms or the use or nature of the software, under any kind of legal claim.***

### Definitions

The **licensor** is the individual or entity offering these terms, and the **software** is the software the licensor makes available under these terms.

**You** refers to the individual or entity agreeing to these terms.

**Your company** is any legal entity, sole proprietorship, or other kind of organization that you work for, plus all organizations that have control over, are under the control of, or are under common control with that organization.  **Control** means ownership of substantially all the assets of an entity, or the power to direct its management and policies by vote, contract, or otherwise.  Control can be direct or indirect.

**Your licenses** are all the licenses granted to you for the software under these terms.

**Use** means anything you do with the software requiring one of your licenses.

## Texts, figures and documentation

The texts, figures, `llms.txt` and `API.md` are under **Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)**: https://creativecommons.org/licenses/by-nc/4.0/

## Commercial use

Commercial use (paid services, products, consultancy) needs written permission from the author.

## Third-party notices

The methods follow published papers and earlier open code by the same author and co-authors. These are under the MIT License, whose notices are kept here:

- **PV_ELM_pred** (ELM variants): MIT License, Copyright (c) 2026 Martin Leiva, Xavier Silvani, Gilles Notton, Cyril Voyant et al. https://doi.org/10.5281/zenodo.21487267
- **ARTU** (`kalpha.js` holds its K–α tables): MIT License, Copyright (c) 2021 Cyril Voyant.
- **cyclostationary-forecasting-matlab** (BLEND, CLIPER, Holt-Winters, Theta, PAR): MIT License, Copyright (c) 2026 Cyril Voyant. https://doi.org/10.5281/zenodo.18812334
- **nice-metrics** (NICE^k): MIT License. https://doi.org/10.5281/zenodo.23562549

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

Those repositories stay under MIT. The NonCommercial terms apply only to FrugalCast itself.

## Example data

The example series are third-party data. They are not under the FrugalCast licence: each keeps its own terms, below. The transformations made for FrugalCast are listed.

- `example-ghi.js`: hourly global horizontal irradiance, Kragujevac (Serbia). Contains modified Copernicus Atmosphere Monitoring Service information, 2026 (CAMS radiation service). Transformation: hourly means of the CAMS values, rounded to 0.1 W/m².
- `example-gti.js`: global tilted irradiance, Ajaccio PV wall (France), 5-min steps, spring 2009. Published with the author's permission. Values unchanged.
- `example-dkasc.js`: PV production, DKASC Alice Springs (Australia), array 29 (CSUN 6.0 kW), 5-min steps. Source: DimRed data set, Webservice-Energy STAC catalog, MINES Paris PSL, https://stac.webservice-energy.org/collections/dimred, quality-checked data from the Desert Knowledge Australia Solar Centre (https://dkasolarcentre.com.au). 4,896 values (the data owner asks for at most 5,000), none flagged or filled in this window; rounded to 0.1 W. Not to be reused outside FrugalCast without the data owners' terms.
- `example.js`: hourly electricity production, Corsica, EDF SEI open data, Licence Ouverte / Open Licence Etalab (https://www.etalab.gouv.fr/licence-ouverte-open-licence/); source: EDF SEI. Transformation: regular UTC grid; 2 hours missing at clock changes filled with the previous value, 1 duplicated hour removed.
- `example-sunspots.js`: monthly mean total sunspot number V2.0, WDC-SILSO, Royal Observatory of Belgium, Brussels, https://www.sidc.be/SILSO/ (doi:10.24414/qnza-ac80), CC BY-NC 4.0. Values unchanged.
- `example-eurusd.js`: US dollar/euro ECB reference exchange rate, daily. Source: ECB statistics, https://data.ecb.europa.eu/ (EXR.D.USD.EUR.SP00.A). Values unchanged; days without a published rate have no line.
- `example-us10y.js`: market yield on US Treasury securities at 10-year constant maturity, daily. Source: Board of Governors of the Federal Reserve System, H.15 Selected Interest Rates, https://www.federalreserve.gov/releases/h15/; U.S. Treasury. Values unchanged; days without a published value have no line.

