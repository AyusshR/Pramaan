# Pramaan — Privacy-First Identity Verification

Pramaan is a consent-based identity and credential verification prototype. It demonstrates how a person can share specific verification answers with an organisation without giving the organisation access to the person's complete identity documents.

A person can use a stable Pramaan card ID, manage demo credentials, review incoming requests and approve or deny individual questions. Verifiers can register, choose questions allowed for their organisation type, state a purpose and receive the approved result.

> **Project status:** This is an educational/demo prototype, not a production identity-verification service. Government-agency connections, document OCR/AI, blockchain, real OTP delivery, biometric authentication and SMS/email delivery are not connected.

## Features

### Person / cardholder
- Sign in using a registered phone number **or** Pramaan card ID.
- Apply for a simulated digital or physical card.
- Keep the same card ID across logins and card reissue.
- Print a digital card using the browser print dialog and choose **Save as PDF**.
- View the credential wallet and connect sample credential sources.
- Upload a credential file in the browser demo and choose its credential type, including a custom type.
- Review verification requests and approve selected questions or deny a request.
- See an over-ask warning when a verifier requests three or more questions.
- Set request expiry, review activity history and filter history entries.
- Revoke access, block/report a verifier and disable a lost card.
- View in-app notifications and manage demo notification preferences.

### Verifier
- Register as an organisation and choose a verifier category.
- Sign in using a registered phone number or email address.
- Enter a card ID or the person's registered phone number.
- Select questions from the predefined list for the verifier category.
- State the purpose of a request and send it to the person for consent.
- Receive only the answers the person approved.
- View verification history and use the sample API interface.

### Privacy and interface
- English and partial Hindi interface translations.
- Plain-language explanation of the intended Fetch → Read → Locate → Answer → Delete process.
- Demo verifier registry badge.
- QR scanning on compatible browsers and Web NFC where supported, with manual entry as a fallback.
- Responsive dark interface with graphite and neon-lime styling.

## How the demo verification flow works

1. A person registers and receives a demo Pramaan card ID.
2. A verifier identifies the person using the card ID or registered phone number.
3. The verifier selects permitted questions and supplies a purpose.
4. The person receives the request and reviews what is being asked.
5. The person approves selected questions or denies the request.
6. The demo backend evaluates mock agency records and returns an answer such as **Yes**, **No**, **Could not determine** or **Revoked**.
7. The activity history records request and answer metadata.

The intended real-world architecture is to fetch only the required record through an authenticated agency connection, inspect only the necessary field, return a limited answer and discard the fetched document and extracted text. **That agency-fetch/OCR/AI/deletion pipeline is explanatory in this prototype; it is not actually connected.**

## Tech stack

- Node.js (built-in modules)
- HTML
- CSS
- Browser JavaScript
- Node.js built-in test runner
- Vercel serverless function adapter for deployment

The project does not require third-party npm packages in its current form.

## Project structure

```text
Pramaan/
├── api/
│   └── [...path].js       # Vercel catch-all function entry point
├── public/
│   └── index.html         # Frontend markup, styles and browser JavaScript
├── tests/
│   └── smoke.test.js      # Automated API/workflow tests
├── server.js              # HTTP server, demo API, routes and demo data
├── package.json           # Project metadata and npm scripts
├── vercel.json             # Vercel routing and function configuration
└── README.md               # Project documentation
```

## Run locally

### Requirements
- Node.js 18 or later
- Git (optional, for cloning the repository)

### 1. Clone the repository

```bash
git clone https://github.com/<your-username>/<your-repository>.git
cd <your-repository>
```

### 2. Start the server

```bash
npm start
```

Open **http://localhost:3000** in your browser.

No `npm install` is required for the current version because the backend uses Node.js built-in modules.

### 3. Run the tests

In a second terminal, or after stopping the server:

```bash
npm test
```

The automated tests start a temporary local server and exercise the main demo API workflows.

## Demo accounts

The backend seeds example accounts for trying both sides of the workflow.

| Role | Phone number | Email | Demo OTP |
|---|---|---|---|
| Person | `9876543210` | — | `123456` |
| Verifier — Employer | `9000000001` | Use the email shown/registered in the app | `123456` |
| Verifier — College | `9000000002` | Use the email shown/registered in the app | `123456` |

The OTP is fixed for demonstration. It is **not** sent by SMS. Use the account details supported by the login screen and current demo data.

## Deploy to Vercel

This repository includes:
- `vercel.json` to route incoming requests to the catch-all API function.
- `api/[...path].js` as the Vercel function entry point.
- A Vercel-aware data path in `server.js`.

### Steps
1. Push the complete repository to GitHub. Keep `api/`, `public/`, `tests/`, `server.js`, `package.json` and `vercel.json` in the repository root.
2. In Vercel, choose **Add New → Project** and import the GitHub repository.
3. Keep the Root Directory set to `./`.
4. Allow Vercel to detect the Node project. Do not set a static output directory for this server-rendered/API-backed app.
5. Deploy. Later commits to the connected GitHub branch can trigger new deployments.

### Important Vercel storage limitation

Vercel's deployed application files are read-only. When running on Vercel, this demo writes its JSON data file under `/tmp` to avoid the `EROFS: read-only file system` startup error.

`/tmp` is temporary and is not a durable database. Serverless function instances may have separate temporary filesystems, and temporary data can disappear. **Do not rely on this storage for persistent users, cards, requests or history.** For persistent multi-user use, connect a managed database (for example, PostgreSQL or Supabase) and replace the JSON-file data layer.

## Demo limitations and security notes

| Capability | Prototype behaviour |
|---|---|
| OTP login | Fixed demo OTP `123456`; no SMS/email OTP provider |
| Fingerprint/biometric option | Demo shortcut only; no real biometric authentication |
| Card issuance | Simulated card issuance and card ID |
| QR / NFC | Browser/device-dependent reading; not cryptographic card authentication |
| Credential uploads | Browser-side demo only; file content is not a verified agency document |
| AI / OCR | Not connected; answers are calculated from mock records |
| Government agency records | Mock data only |
| Document deletion pipeline | Described in the UI; no live agency document is fetched or processed |
| Blockchain | Not connected |
| Verifier trust badge | Demo registry label; not real organisation due diligence |
| SMS and email notifications | Simulated; in-app notifications are demo data |
| Support form | Demo/local ticket behaviour; no real support team is contacted |
| Hindi | Partial translations; some dynamic or technical text may remain English |
| Screenshot prevention | Cannot be guaranteed in a normal web browser |

Do not upload real identity documents or use this prototype to make real eligibility, employment, admission, accommodation or financial decisions. Before production use, implement persistent storage, real identity/agency integrations, secure OTP or passkey authentication, access controls, encryption, rate limiting, key management, monitoring, backups, privacy/legal review and an independent security assessment.

## Contributing

Issues and pull requests are welcome. For proposed changes, please:
1. Describe the user-facing behaviour being changed.
2. Keep demo-only capabilities clearly labelled.
3. Run `npm test` before submitting a pull request.

## License

No license is specified yet. Add a `LICENSE` file before allowing others to reuse, modify or distribute this project.
