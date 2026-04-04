# Nimbus Installation Guide

Follow these steps to set up your local development environment for the Nimbus project.

## Prerequisites
- **Node.js 18.17+** (Recommended: 20+)
- **npm** (Included with Node.js)
- **Supabase CLI** (Required for local database state)
- **Docker Desktop** (To run Supabase services locally)

## Step 1: Clone the Repository
```bash
git clone https://github.com/everydaycodings/Nimbus.git
cd Nimbus
```

## Step 2: Install Dependencies
```bash
npm install
```

## Step 3: Configure Environment Variables
Copy the `.env.example` file to `.env.local`:
```bash
cp .env.example .env.local
```
Then, update the variables in `.env.local` with your configuration.

## Step 4: Start Supabase Locally
Ensure Docker is running, then start the Supabase services:
```bash
npx supabase start
```
This will initialize your local database, auth, and storage services.

## Step 5: Run Migrations
Apply any pending database migrations to your local instance:
```bash
npx supabase db reset
```

## Step 6: Start the Development Server
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser to view the application.

### Important Notes
- **Authentication**: By default, Supabase local auth is available. You can use any email for testing.
- **Storage**: Ensure your AWS S3 buckets are correctly configured in `.env.local` if you are using the S3-backed storage features.
