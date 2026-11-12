# HJ Studio – Digital Album Maker

Create realistic 3D digital photo albums, share them with a permanent link or QR code, and let customers view and download their photos. No customer login required.

**Stack:** HTML5, CSS3, vanilla JavaScript, Netlify Functions, MongoDB Atlas, Cloudinary.

## How it works

- The browser never touches MongoDB. All data goes through Netlify Functions (`/api/*`).
- Photos upload straight from the browser to Cloudinary using a short-lived **signature** issued by `upload-sign`. The Cloudinary API secret stays on the server.
- Admin pages are protected by a login (JWT, 12 hours). Customer pages (`/album/HD7291`) use the public `public-album` function.
- Every album has a permanent ID. Admins can disable or reactivate a link at any time; drafts are never public.

## Project files

```
index.html  style.css  app.js
netlify.toml  package.json  .env.example
netlify/functions/
  _lib.js          shared helpers (DB, auth, Cloudinary)
  auth-login.js    admin sign in
  albums.js        albums CRUD, dashboard stats
  customers.js     customer records
  settings.js      studio settings
  upload-sign.js   signed Cloudinary uploads
  public-album.js  public album data for customers
```

## 1. MongoDB Atlas setup

1. Create a free account at https://www.mongodb.com/atlas and create a **free (M0) cluster**.
2. **Database Access** > Add New Database User. Choose a username and a strong password (letters and numbers avoid URL-encoding problems). Give it **Read and write to any database**.
3. **Network Access** > Add IP Address > **Allow access from anywhere** (`0.0.0.0/0`). Netlify Functions use changing IPs, so this is required. The database password keeps it protected.
4. **Database** > Connect > **Drivers** > copy the connection string. Replace `<password>` with your user's password. This is your `MONGODB_URI`.
5. Collections (`albums`, `customers`, `settings`) and indexes are created automatically on first use.

## 2. Cloudinary setup

1. Create a free account at https://cloudinary.com.
2. Open **Settings > API Keys** (or the Dashboard) and copy the **Cloud name**, **API Key** and **API Secret**.
3. No upload preset is needed: uploads are signed by the server.
4. Free plans limit a single image to 10 MB. The app allows up to 20 MB per file (`MAX_MB` at the top of `app.js`); lower it to 10 if you stay on the free plan.

## 3. Deploy to Netlify

1. Push this folder to a GitHub repository (`.env` is git-ignored).
2. In Netlify: **Add new site > Import an existing project**, pick the repo. Build command: leave empty. Publish directory: `.` (already set in `netlify.toml`).
3. **Site configuration > Environment variables**, add:

| Variable | Value |
|---|---|
| `MONGODB_URI` | Atlas connection string |
| `MONGODB_DB` | `hj_studio` (optional) |
| `CLOUDINARY_CLOUD_NAME` | from Cloudinary |
| `CLOUDINARY_API_KEY` | from Cloudinary |
| `CLOUDINARY_API_SECRET` | from Cloudinary |
| `ADMIN_EMAIL` | your login email |
| `ADMIN_PASSWORD` | a long, unique password |
| `JWT_SECRET` | random string, 32+ characters |

4. Deploy (or **Trigger deploy** after adding variables).
5. Open `https://your-site.netlify.app/admin`, sign in, and open **Settings** to set your studio name and (optionally) your custom domain so shared links use it.

Alternatively with the CLI: `npm i -g netlify-cli`, `netlify login`, `netlify init`, `netlify deploy --prod`.

## Run locally

```
npm install
cp .env.example .env     # fill in real values
npx netlify-cli dev      # http://localhost:8888/admin
```

## Using the platform

1. **Create album**: name, customer, event type, theme, cover and photos.
2. **Album editor**: drag photos to reorder (or use the arrows on touch screens), add captions, switch a photo to **Full spread** to stretch it across two pages, choose download permission, preview, then **Publish**.
3. **Share**: copy the link, send it by WhatsApp, or download the QR code from **QR generator**.
4. **Disable or reactivate** a link from the album card or the editor. Disabled links show a friendly message.

### Download permission (per album)

- **Off**: no download buttons.
- **Web size**: 2400 px JPEG, good for phones and sharing.
- **Original quality**: the exact files you uploaded.

Download buttons are hidden when off, but anyone who can view a photo in the browser can technically save it. Use **Off** to discourage downloads, not to prevent copying.

## Notes

- ZIP downloads are built in the customer's browser. Very large albums (hundreds of originals) can be heavy on phones; use **Web size** for those.
- Deleting an album also deletes its photos from Cloudinary. Removing a photo in the editor and saving deletes it from Cloudinary too.
- To change the admin password, change `ADMIN_PASSWORD` in Netlify and redeploy.
