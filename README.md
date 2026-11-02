# LearnKit

Upload lecture notes or a chapter as a PDF, Word document, or text file. LearnKit stores the file in **Firebase**, then a Cloud Function calls **Gemini** to build a multiple-choice quiz and a flashcard deck.

## What you get

- Landing page with email/password and Google sign-in
- Dashboard to upload files and browse your library
- Quiz mode (10 questions, four options, explanations)
- Flashcard mode (flip, mark known / still learning)
- Scores saved in Firestore

## 1. Firebase project

In the [Firebase console](https://console.firebase.google.com/):

1. Use your existing project (or create one).
2. Enable **Authentication** → Email/Password and Google.
3. Create a **Firestore** database (production mode is fine once these rules are deployed).
4. Enable **Storage**.
5. Enable **Functions** (Blaze billing is required for Cloud Functions and for the Gemini API).
6. Register a **Web app** and copy the config object.

Paste that object into [`js/firebase-config.js`](js/firebase-config.js).

Also set the project id in [`.firebaserc`](.firebaserc):

```json
{
  "projects": {
    "default": "your-project-id"
  }
}
```

## 2. Gemini API key

1. Create a key in [Google AI Studio](https://aistudio.google.com/apikey).
2. Do **not** put the key in the HTML or `firebase-config.js`.
3. After installing the Firebase CLI, store it as a function secret:

```bash
firebase functions:secrets:set GEMINI_API_KEY
```

## 3. Deploy

```bash
npm install -g firebase-tools
cd functions
npm install
cd ..
firebase login
firebase deploy
```

That publishes Hosting (this static site), Firestore rules, Storage rules, and the `generateStudySet` function.

### Local preview of the site

After filling in `js/firebase-config.js`:

```bash
npx --yes serve .
```

Open the printed URL. Generation still needs the deployed (or emulated) Cloud Function.

If Firestore asks for a composite index on `sets` (`ownerId` + `createdAt`), accept the link in the browser console once.

## 4. Authorized domains

In Authentication → Settings → Authorized domains, add:

- `localhost`
- your Firebase Hosting domain (`your-project.web.app`)
- any custom domain

For Google sign-in, add the same origins in the Google Cloud OAuth client if the console asks.

## Data layout

| Path | Purpose |
| --- | --- |
| `users/{uid}` | Profile |
| `sets/{setId}` | Metadata, status, extracted text |
| `sets/{setId}/quiz/{id}` | Multiple-choice items |
| `sets/{setId}/cards/{id}` | Flashcards |
| `progress/{uid}_{setId}` | Last quiz score and card marks |
| Storage `uploads/{uid}/{setId}/{fileName}` | Original file |

## Repo layout

```
index.html      Landing and auth
app.html        Upload + library
study.html      Quiz and flashcards
css/styles.css
js/             Firebase client, auth, upload, study player
functions/      generateStudySet (Gemini)
firestore.rules
storage.rules
firebase.json
```
