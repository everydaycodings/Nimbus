# Sign-in, single sign-on and account security

This guide covers who can join a Nimbus, every way to sign in (password, Google, GitHub, an OpenID Connect provider, passkeys, a QR code on the phone, app passwords) and two-factor authentication. Admin settings live under **Admin → People** and **Admin → Security → Authentication**. Each member's own settings are on their **Account** page.

In the examples, `https://nimbus.example.com` is your Nimbus address (`BETTER_AUTH_URL`).

## The first account and approvals

- **The first account you create becomes the owner.** Sign up right after installing. There is exactly one owner, enforced by the database. The owner can do everything an admin can, and can't be demoted, rejected or removed.
- **Admins** are promoted by the owner. They approve members and change instance settings.
- **Members** manage their own files and whatever is shared with them.

Everyone who signs up after the owner waits for an admin to approve them under **Admin → People → Approvals**, unless the sign-up mode says otherwise. Admins get a notification for each request. A rejected account is kept, so it can be approved later.

| Account status | Can sign in | Sees |
|---|---|---|
| Pending | Yes | A "waiting for approval" screen, no files |
| Active | Yes | The app |
| Rejected | Yes | A "your request was declined" screen, no files |

### Sign-up mode

Choose it under **Admin → People → Sign-ups & invites**:

| Mode | What happens |
|---|---|
| Approval (default) | Anyone can create an account. An admin approves it before it can store files |
| Invite only | People join through an invite link, and their account is ready right away |
| Open | Anyone who signs up gets an account right away |
| Closed | No new accounts. Existing members keep their access |

Ways to skip approval, in every mode except Closed:

- **Invite links**, made by an admin, with an optional expiry (1, 7 or 30 days) and use limit.
- **Trusted domains**: a confirmed email on a listed domain, such as `example.com`, skips approval. Google and GitHub sign-ins from these domains skip it too.
- **Share invites**: when someone shares a file with an email that has no account, the emailed link (good for 30 days) skips approval for that address.
- **OIDC**: people who first sign in through your OIDC provider skip approval. See [Single sign-on with OIDC](#single-sign-on-with-oidc).

## Passwords

- New passwords must be at least 10 characters by default, with a meter that flags guessable ones, and no forced mix of character types (NIST guidance). Change the rules under **Admin → Security → Authentication → Password rules**. The same section sets the rules for vault passphrases (12 characters by default). Existing passwords keep working until they're changed.
- Password reset by email needs email set up (**Admin → System → Email**). Without email, an admin sets a temporary password for the member, who must replace it at the next sign-in.
- When email works, members must confirm their email address. Accounts with two-factor on skip this.

## Google and GitHub sign-in

Set the keys in `.env` (or `apps/web/.env.local` in development):

```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
```

Use these callback URLs when creating the OAuth apps:

| Provider | Callback URL |
|---|---|
| Google | `https://nimbus.example.com/api/auth/callback/google` |
| GitHub | `https://nimbus.example.com/api/auth/callback/github` |

In development, use `http://localhost:3000` as the address.

A provider's button only appears once both of its keys are set.

**Linking accounts:** a Google or GitHub sign-in links to an existing account with the same email only when that account's email is confirmed. So nobody can register someone else's email with a password and then take over their Google or GitHub sign-in. Members connect and disconnect providers under **Account → Sign-in methods**. The provider's email must match the account's.

## Single sign-on with OIDC

Nimbus can use one OpenID Connect provider, such as Authentik, Keycloak or Zitadel. Set it up in **Admin → Security → Authentication → Single sign-on (OIDC)**, or in env. Env wins, and locks the admin form.

```
OIDC_ISSUER=https://auth.example.com/application/o/nimbus/
OIDC_CLIENT_ID=nimbus
OIDC_CLIENT_SECRET=...
OIDC_NAME=Authentik        # the button says "Sign in with Authentik"
OIDC_ONLY=false            # true hides password, Google and GitHub (the owner keeps a password)
```

| Setting | Meaning |
|---|---|
| `OIDC_ISSUER` | The issuer URL. Nimbus reads `<issuer>/.well-known/openid-configuration` |
| `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | The client's credentials |
| `OIDC_NAME` | The name on the button. Defaults to "SSO" |
| `OIDC_ONLY` | `true` hides the other sign-in methods, once the provider is fully set up |

In the provider, register:

- the redirect URL `https://nimbus.example.com/api/auth/callback/oidc`,
- a confidential client (it has a secret), with the scopes `openid email profile`. Nimbus uses PKCE.

The client secret entered in the admin form is sealed with `BETTER_AUTH_SECRET`. If that secret changes, enter the client secret again. Saving applies without a restart.

How OIDC sign-ins behave:

- New people who sign in with it skip approval, unless sign-ups are Closed.
- It links to an existing account only when that account's email is confirmed.
- With **OIDC only**, the owner keeps a password way in, so a broken provider can't lock everyone out.

### Authentik

Applications → Create with provider → OAuth2/OpenID. The issuer is:

```
https://<authentik>/application/o/<app-slug>/
```

### Keycloak

Create a client in your realm with Client authentication on. The issuer is:

```
https://<keycloak>/realms/<realm>
```

## Two-factor authentication

Each member turns it on under **Account → Two-factor authentication**: scan the code with an authenticator app, prove it works with one code, then save the 10 backup codes. It works without email.

- At sign-in, after the password, Nimbus asks for a code, a backup code, or a passkey.
- **Don't ask again on this device for 30 days** skips the code on that browser.
- **Google, GitHub and OIDC sign-ins** ask for the Nimbus code too, for accounts that have two-factor on. In the Android app, the provider sign-in hands over to the app's two-factor screen.
- **Trust the provider's own MFA:** under **Admin → Security → Authentication → Two-factor with single sign-on**, an admin can let OIDC sign-ins skip the Nimbus code. Use it when the provider already asks for a second step. It is off by default and applies only to OIDC, not Google or GitHub.
- **Require two-factor**: an admin can make every password account set it up before using Nimbus. Nobody can turn it off while this is on.
- An admin can reset a member's two-factor from **Admin → People → Members**. It is recorded in the audit log.

## Passkeys

Members sign in with a fingerprint, face or screen lock instead of a password. Add them under **Account → Passkeys**.

- A passkey also stands in for the two-factor code.
- Passkeys need HTTPS and a domain name (not an IP address). `localhost` works for trying them in development.
- **Allow passkeys** (on by default) is under **Admin → Security → Authentication → Passkeys**. Off hides them everywhere. Passkeys people already added are kept.
- **Require a passkey** makes everyone add one before they can use Nimbus. They can still sign in with their password. It can't be turned on until the admin has a passkey.
- **Android app:** passkeys work in the app when the server lists the app's signing key at `/.well-known/assetlinks.json`. Set `ANDROID_RELEASE_SHA256` to the release certificate's SHA-256 fingerprint (`AA:BB:…`, as `keytool` prints it). See [android.md](android.md).

## Sign in on your phone with a QR code

Add the Android app without typing your password on the phone:

1. On the web, open **Account → Sign in on your phone**.
2. Scan the QR code with the app, or type the short code it shows (eight characters, like `ABCD-EFGH`).
3. Approve the device in your browser.

The code works once and lasts 2 minutes. The QR holds only the server address and a one-time token, never a password. Only hashes are stored.

An admin can turn this off with **Allow QR and code sign-in** under **Admin → Security → Authentication → Sign in with a QR code**. Devices already signed in stay signed in.

## App passwords (WebDAV and other clients)

WebDAV clients and other apps that can't do a browser sign-in use your email plus an **app password**. Make them under **Account → Connect a device**:

- One per device, **Read & write** or **Read only**.
- Shown once. Revoke it any time.
- It stops working after 90 days unused.
- Works for accounts with two-factor, and for Google, GitHub or OIDC accounts.
- 10 wrong tries from one IP block that IP for 15 minutes.
- Each new one sends a "New app password" notification (bell and email) naming the device and IP.

An admin sees a member's app passwords on their page under **Admin → People → Members**, with Revoke and a per-member off switch.

## Saved logins and several accounts

Both are under **Admin → Security → Authentication**:

| Setting | What it does |
|---|---|
| Allow saved logins | After signing in, people can save their login on that browser and come back with one tap. Two-factor is still asked. Saved logins stop working after 90 days unused, or when the password changes |
| Let owners and admins save logins | Off keeps admin accounts on their password every time |
| Allow several accounts per browser | People sign in to more than one account in the same browser and switch from the account menu. Off hides "Add an existing account" |

## Where the settings are

| Setting | Place |
|---|---|
| Sign-up mode, invite links, trusted domains | Admin → People → Sign-ups & invites |
| Approve or reject new members | Admin → People → Approvals |
| Password rules, two-factor, passkeys, OIDC, QR sign-in, saved logins | Admin → Security → Authentication |
| Every admin change, with old and new value | Admin → Security → Audit log |
| Your own two-factor, passkeys, providers, app passwords | Account |

## See also

- [install.md](install.md): the first start and creating the owner
- [configuration.md](configuration.md): `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, `GOOGLE_*`, `GITHUB_*`, `OIDC_*`
- [android.md](android.md): signing in on the phone
- [secrets.md](secrets.md): unlocking the Secrets section
