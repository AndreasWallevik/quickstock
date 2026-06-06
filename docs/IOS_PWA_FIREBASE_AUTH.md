# iOS PWA Firebase Auth

QuickStock uses Google sign-in through Firebase Auth.

## Current app behavior

- Desktop browser uses `signInWithPopup`.
- Mobile browser and iOS standalone PWA use `signInWithRedirect`.
- Normal browser sessions use `VITE_FIREBASE_AUTH_DOMAIN`, usually `quickstock-b04b2.firebaseapp.com`.
- Installed iOS PWA sessions use the current HTTPS host as `authDomain`.

For a PWA installed from:

```text
https://quickstock-b04b2.web.app/
```

Firebase Auth redirects through:

```text
https://quickstock-b04b2.web.app/__/auth/handler
```

This same-origin auth helper is required for iOS standalone mode because Safari/iOS Web App storage partitioning can block the default cross-origin Firebase Auth redirect helper.

## Required Firebase Auth authorized domains

In Firebase Console > Authentication > Settings > Authorized domains, include:

```text
quickstock-b04b2.firebaseapp.com
quickstock-b04b2.web.app
```

Also include any custom production domain that users can install as a PWA.

## Required Google OAuth redirect URIs

In Google Cloud Console > APIs & Services > Credentials > OAuth 2.0 Client IDs > Web client, add this authorized redirect URI:

```text
https://quickstock-b04b2.web.app/__/auth/handler
```

Keep the existing Firebase default redirect URI as well:

```text
https://quickstock-b04b2.firebaseapp.com/__/auth/handler
```

If users install the PWA from a custom domain, add that exact host too:

```text
https://<custom-domain>/__/auth/handler
```

## PWA return URL

The PWA manifest uses:

```text
start_url: /
display: standalone
```

When installed from `quickstock-b04b2.web.app`, the standalone app returns to:

```text
https://quickstock-b04b2.web.app/
```

The Google OAuth redirect URI is not the manifest `start_url`; it is the Firebase Auth helper URL ending in `/__/auth/handler`.
