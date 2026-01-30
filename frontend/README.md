# NYT Bestsellers Frontend

A mobile-friendly Next.js app to browse, search, and discover NYT bestseller data stored in MotherDuck.

## Features

- **Browse** - Select from available bestseller lists and view rankings by date
- **Search** - Search books by title or author with debounced input
- **I'm Feeling Lucky** - Get a random book from current bestsellers

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Styling**: Tailwind CSS (mobile-first)
- **Database**: MotherDuck (via REST API)
- **Deployment**: Vercel

## Project Structure

```
frontend/
├── app/
│   ├── layout.tsx          # Root layout with navigation
│   ├── page.tsx            # Home page with featured lists
│   ├── browse/page.tsx     # Browse by list/date
│   ├── search/page.tsx     # Search results
│   └── api/
│       ├── lists/route.ts      # GET available lists
│       ├── rankings/route.ts   # GET rankings by list/date
│       ├── search/route.ts     # GET search results
│       └── random/route.ts     # GET random book
├── components/
│   ├── BookCard.tsx        # Book display component
│   ├── SearchBar.tsx       # Search input with debouncing
│   └── Navigation.tsx      # Mobile bottom navigation
├── lib/
│   └── db.ts               # MotherDuck connection helper
└── public/
    └── manifest.json       # PWA manifest
```

## Local Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create `.env.local` with your MotherDuck credentials:
   ```
   MOTHERDUCK_TOKEN=your_token_here
   MOTHERDUCK_DATABASE=nyt_bestsellers
   ```

3. Run the development server:
   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000)

## Deployment to Vercel

1. Push to GitHub

2. Import to Vercel:
   - Connect your GitHub repository
   - Set root directory to `frontend`
   - Add environment variables:
     - `MOTHERDUCK_TOKEN` - Your MotherDuck auth token
     - `MOTHERDUCK_DATABASE` - Database name (e.g., `nyt_bestsellers`)

3. Deploy

## API Endpoints

### GET /api/lists
Returns all available bestseller lists with display names.

### GET /api/rankings
Query params:
- `list` (required) - List name encoded (e.g., `hardcover-fiction`)
- `date` - Date (YYYY-MM-DD) or `latest` (default)
- `page` - Page number (default: 1)
- `pageSize` - Results per page (default: 15)

### GET /api/search
Query params:
- `q` (required) - Search query (min 2 chars)
- `page` - Page number (default: 1)
- `pageSize` - Results per page (default: 20)

### GET /api/random
Returns a random book from current bestseller lists with list appearance history.

## Mobile Design

- Single column layout on mobile
- Bottom navigation bar with 44px minimum touch targets
- Safe area insets for iOS
- Dark mode support
