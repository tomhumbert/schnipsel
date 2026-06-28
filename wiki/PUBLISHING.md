# Publishing this wiki to GitHub

GitHub wikis are hosted in a separate git repository at `<repo>.wiki.git`. These files need to be pushed there.

## Steps

1. **Enable the wiki** on the GitHub repo settings page (Settings → Features → Wikis).

2. **Visit the wiki once** to initialise it (click the Wiki tab and create a placeholder page).

3. **Clone the wiki repo** alongside your project:
   ```bash
   git clone git@github.com:tomhumbert/schnipsel.wiki.git ../schnipsel.wiki
   ```

4. **Copy the wiki files** into the wiki repo:
   ```bash
   cp wiki/*.md ../schnipsel.wiki/
   # Remove this publishing guide — it's not a wiki page
   rm ../schnipsel.wiki/PUBLISHING.md
   ```

5. **Commit and push:**
   ```bash
   cd ../schnipsel.wiki
   git add .
   git commit -m "Add comprehensive developer wiki"
   git push
   ```

6. Verify at `https://github.com/tomhumbert/schnipsel/wiki`.

## Page names and URLs

GitHub wiki URLs are derived from filenames:
- `Home.md` → `/wiki/Home` (the landing page)
- `Getting-Started.md` → `/wiki/Getting-Started`
- `_Sidebar.md` → rendered as the navigation sidebar on every page

The internal links in these files (e.g., `[Architecture](Architecture)`) work correctly in the GitHub wiki.
