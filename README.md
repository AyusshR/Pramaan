# Pramaan — cleaned prototype


## Visual refresh

The public landing page now uses a bold, editorial layout inspired by the reference site's high-contrast typography, numbered sections, scrolling ticker, and subtle reveal motion. Pramaan keeps its own dark graphite and lime identity rather than copying the reference site. The existing sign-in, person and verifier workflows are retained. The landing page respects `prefers-reduced-motion` and adapts to mobile screens.

A cleaner, more readable version of the Pramaan consent-based identity verification demo.

## 1. Run the website

**Requirement:** Node.js 18 or newer.

1. Extract this ZIP file.
2. Open the extracted `pramaan-clean` folder in VS Code.
3. Open **Terminal → New Terminal**.
4. Run:

   ```bash
   npm start
   ```

5. Open [http://localhost:3000](http://localhost:3000) in your browser.

This version uses Node's built-in modules, so you do **not** need to run `npm install`.

## 2. Demo logins

Use the fixed demo OTP `123456` for every account.

| Role | Phone number | Account |
|---|---:|---|
| Person | `9876543210` | Riya Sharma |
| Verifier | `9000000001` | TechNova HR (Employer) |
| Verifier | `9000000002` | Sample University (College) |

You can also register a new person or verifier with another 10-digit number.

## 3. Suggested feature test

1. Log in as **Riya Sharma** (`9876543210`).
2. Open **My card** and apply for a digital card.
3. Log out and log in as **TechNova HR** (`9000000001`).
4. Open **New check**, enter Riya's card ID (or phone number), add a purpose, select one or more allowed questions, and send the request.
5. Log out and log back in as Riya. Open **Requests**.
6. Approve only one of the questions. Notice the verifier receives only the answer to the selected question.
7. Log in as TechNova HR again and open **History** to see the result.
8. Try **Wallet**, **Activity**, **Settings**, **Revoke access**, **Block**, and **Disable card**.
9. As a verifier, open **Portal API** to view the sample API key and API requests.

## 4. What each file does

```text
pramaan-clean/
├── server.js              # Node server, API routes, demo data and session handling
├── package.json           # Project name, Node requirement and start/test commands
├── README.md              # Setup and feature guide
├── data.json              # Created automatically when the server starts
├── public/
│   └── index.html         # Website layout, styles and browser-side JavaScript
└── tests/
    └── smoke.test.js      # Automated tests for the main API journeys
```

### `server.js`

The backend is divided into clearly marked sections:

1. **Persistent data and sessions** — loads/saves demo accounts and keeps login sessions in memory.
2. **Mock agency records and question rules** — sample source records and the rules that return Yes, No, Could not determine or Source revoked.
3. **Shared helpers** — JSON responses, login checks, notifications, logs and request creation.
4. **API handlers** — login, card, wallet, requests, consent, history, blocking, preferences, account deletion and verifier API.
5. **Static web server** — serves the frontend from `public/`.

### `public/index.html`

This file contains the website's HTML, CSS and browser JavaScript. The script is divided into:

1. App state and utility functions
2. Navigation and session startup
3. Landing page
4. Login and registration
5. Person pages (card, wallet, requests, activity and settings)
6. Verifier pages (new check, history and API)
7. Privacy and help pages
8. Notifications and background refresh

## 5. What is implemented vs simulated

| Feature | Current prototype behaviour |
|---|---|
| Person and verifier login | Working demo OTP (`123456`), not real OTP delivery |
| Person / verifier registration | Working with demo data |
| Digital / physical card application | Working as a simulated issuance flow |
| QR code | Generates a link containing only the card reference; QR library loads from a CDN |
| Manual card ID / phone lookup | Working |
| NFC | Attempts Web NFC where supported; otherwise falls back to manual entry |
| Verifier-specific question lists | Working |
| Per-question consent / deny | Working |
| Yes / No / Could not determine / Revoked | Working using mock records and JavaScript rules, not AI |
| Request history and access expiry | Working in the demo |
| Revoke answer access | Working for active answered requests |
| Block / report verifier | Working as a block plus an audit entry; no external report team exists |
| Credential wallet | Working with in-memory mock source records |
| Notifications | In-app notifications work; SMS/email only print simulated messages in the server terminal |
| Activity log | Working with demo metadata and answer outcomes |
| Settings / account deletion | Working |
| Verifier API | Working local API-key endpoints; not a production integration |
| Hindi | Navigation labels only; the rest of the demo is currently English |
| AI / government agency / blockchain | Not connected; simulated or not implemented |
| Biometric authentication | Not connected; the fingerprint button uses the demo OTP |
| Screenshot prevention | Not possible to guarantee in a normal browser; blur is only a best-effort privacy aid |

## 6. Data and security notes

- `data.json` is generated automatically and stores demo accounts, cards, requests, answers, logs, notifications and verifier API keys.
- Mock agency records are kept in server memory and reset when the server restarts. They are not stored in `data.json`.
- The prototype does not fetch, store or delete real document files. The privacy page explains this accurately.
- Login sessions are stored in memory and are cleared when the server restarts.
- Do not deploy this as a real identity system. It needs proper authentication, authorisation, encryption, secure key management, rate limiting, audit review, threat modelling and legal/privacy review before any real-world use.

## 7. Run automated tests

In the VS Code terminal, run:

```bash
npm test
```

The test suite starts a temporary local server and checks the main flows, including login, card issuance, consent, answer visibility, revocation, blocking, wallet source state, API-key access and disabled cards.

## 8. Features added in version 1.2.0

- **Demo verifier registry badge:** verifier profiles and requests display a Pramaan demo-registry badge. It is a prototype status only, not a real-world organisation or legal verification.
- **Other credentials:** the person can connect additional sample Passport, Driving Licence and Professional Certificate sources in the wallet. Employer and Hotel question lists can use the matching demo facts.
- **Support contact form:** the Help page accepts a subject, category and message, then stores a local demo support ticket and returns a reference ID. It does not send email or contact a real support team.
- **Five-stage explanation:** the Privacy page explains Fetch → Read → Locate → Answer → Delete and distinguishes the real intended architecture from the mock implementation.
- **Verifier notification preferences:** both person and verifier accounts can configure in-app, SMS and email preferences. SMS/email remain terminal-only simulations.
- **Language selector:** English/Hindi navigation and a set of common interface labels are translated. This is a partial Hindi interface, not a complete translation of every paragraph.
- **QR camera scan:** compatible browsers can use the device camera and `BarcodeDetector` to read a Pramaan QR. Unsupported browsers fall back to manual card ID entry.
- **Privacy deterrents:** answer values blur when the browser loses focus, and printing is hidden in the demo. Neither can prevent screenshots or screen recording reliably.
- **Consent pipeline display:** after approval, verifier results show the five demo processing stages. No document file, OCR, AI model or government fetch is actually used.

### Security and production boundaries

The OTP remains fixed at `123456`; the fingerprint button is a demo shortcut, not biometric authentication. The verifier badge is not due diligence. The support form stores tickets locally and does not email them. QR camera scanning and Web NFC require a compatible browser/device and a secure context (HTTPS or localhost). Real OTP delivery, passkeys/biometrics, agency APIs, OCR/AI document reading, secure document deletion, blockchain anchoring, SMS/email providers and production-grade screenshot controls require separate integrations and security review.

## Latest additions

- **Print digital card / Save as PDF:** On the My Card page, use the print button for an active digital card. In the browser print dialog choose “Save as PDF”. The print stylesheet isolates the card from the rest of the page.
- **Upload a credential:** In Wallet, choose a credential type and upload a PDF, JPG or PNG up to 8 MB. This prototype only adds the file name/type/size to the current browser session; file bytes are not uploaded to the server, retained after refresh, or used to answer verifier questions. Do not upload real sensitive identity documents.
- **Over-ask warning:** The verifier form displays a warning when three or more questions are selected. The person still reviews and approves each requested question.
- **Registered-phone lookup:** A verifier can enter the person's registered 10-digit phone number instead of a card ID. The backend resolves the number to the account; user approval is still required.
- **Hindi translation:** Expanded the page text dictionary for common card, wallet, verifier-request, and credential-upload labels. Some dynamic content and technical wording may remain in English.

## Digital card PDF

The browser's native print dialog handles PDF creation. Select **Print digital card / Save as PDF**, then choose **Save as PDF** as the printer/destination. Printing is limited to the card element by the print stylesheet.


## Latest update (v1.3.0)

- Person sign-in supports registered phone number or stable Pramaan card ID. Both use the demo OTP (`123456`); no real SMS OTP is sent.
- Reissuing a disabled card preserves that person's original card ID. Logging in never generates a new card ID.
- Verifier sign-in supports registered phone number or registered email. New verifier registration also requires a contact phone number.
- Requests containing three or more questions are marked as over-ask, create a warning notification for the person, and show a warning in the person's consent inbox. The person can still approve selected questions or deny the request.
- Activity History includes keyword search and filters for request created, approved, rejected, revoked, expired and card activity.
- Credential upload includes an editable custom type when “Other credential” is selected.
