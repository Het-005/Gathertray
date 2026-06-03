# GatherTray

GatherTray is a local catering marketplace product that mirrors key ezCater-style workflows for customers, restaurants, and marketplace operations while positioning around lower fees and tighter partner control.

## Current product surface

- Customer marketplace with ZIP, cuisine, guest-count, budget-first search, delivery, occasion, and sort filters
- Customer restaurant favorites and shortlist saving
- Customer saved searches for quick marketplace re-entry
- Customer reviews for completed orders with live restaurant rating updates
- Restaurant profile pages with package pricing and ordering entry points
- Order builder with customer-set total or per-person budgets and budget-shaped quoting
- Protected order detail pages for customers, restaurants, and admins
- Customer account area with sign-in, signup, notifications, order history, reorder flows, and self-serve profile/security updates
- Customer, restaurant, and admin session management with active-session visibility and revoke controls
- Lightweight rate limiting for login, signup, and password-change abuse protection
- Customer account notifications with structured order/application metadata and persistent unread/read state in web and mobile
- Customer support tickets tied to orders, with admin issue resolution controls
- Restaurant signup flow with document uploads and admin approval
- Restaurant portal for approved merchants to manage menus, delivery zones, and listing details
- Restaurant website field with menu-and-pricing import into an editable package editor
- Restaurant availability controls with blackout dates
- Restaurant listing pause/unpause controls with buyer-side filtering
- Admin dashboard controls for pausing and reactivating restaurant listings
- Restaurant application review states with request-changes notes
- Self-serve restaurant application status tracker by email
- Admin-visible outbound email queue for beta communication tracking
- Machine-readable lead-time rules with event-time validation in ordering
- Restaurant dashboard with incoming order management and status updates
- Restaurant dashboard setup-status cards for website connection and menu import readiness
- Admin operations dashboard with approvals, users, issues, order queue, CSV export, and critical-action audit history
- Admin operations dashboard with approvals, users, issues, order queue, CSV export, sanitized backup export, and critical-action audit history
- Admin operations dashboard with approvals, users, issues, order queue, CSV export, sanitized backup export, saved server snapshots, and critical-action audit history
- Admin operations dashboard with approvals, users, issues, order queue, backup controls, auth security visibility, and critical-action audit history
- Installable PWA shell for a more app-like mobile web experience
- Expo-based mobile scaffold for iOS and Android in `mobile/`

## Main pages

- `index.html`: homepage and product narrative
- `demo.html`: guided demo hub for investors, partners, and first-time viewers
- `marketplace.html`: ezCater-style search results experience
- `restaurant.html?slug=bhatel-republic`: restaurant detail page
- `order.html`: order request builder
- `order-detail.html?id=GT-1001`: protected order detail page
- `account.html`: login, signup, notifications, and customer order history
- `restaurant-signup.html`: merchant application intake
- `restaurant-portal.html`: approved restaurant management
- `restaurant-dashboard.html`: merchant operations view
- `admin-dashboard.html`: admin operations view

## Application files

- `server.rb`: WEBrick server and API endpoints
- `app.js`: frontend state, auth, dashboard, and page logic
- `styles.css`: shared design system and responsive layout rules
- `data/store.json`: persisted local data for restaurants, orders, users, sessions, applications, and notifications
- `manifest.json`: installable app manifest
- `sw.js`: service worker for lightweight offline support
- `Dockerfile`: container run target for local deployment
- `.dockerignore`: container build exclusions
- `mobile/`: first React Native / Expo app scaffold wired to the GatherTray API

## Run locally

Prerequisites:

- Ruby 2.6+ installed
- Port `4567` available
- Optional environment variables:
  - `PORT`
  - `GATHERTRAY_BIND`
  - `GATHERTRAY_DATA_FILE`

1. From this folder, run `ruby server.rb`
2. Open `http://127.0.0.1:4567`

## Run with Docker

1. Build the image with `docker build -t gathertray .`
2. Start the container with `docker run --rm -p 4567:4567 gathertray`
3. Open `http://127.0.0.1:4567`

## Run with Docker Compose

1. Run `docker compose up --build`
2. Open `http://127.0.0.1:4567`
3. GatherTray data will persist in the `gathertray_data` Docker volume

## Share the Code

### Option 1: Git repository

1. This folder is already initialized as a local git repository
2. Add files with `git add .`
3. Commit with `git commit -m "Initial GatherTray beta"`
4. Push to GitHub, GitLab, or Bitbucket
5. Other developers can clone it and run it locally

### Option 2: Zip the project

1. Compress this whole folder
2. Send it to the other developer
3. They unzip it and run `ruby server.rb`

### Best cross-PC path

For the web app, Docker is the easiest handoff because it avoids local Ruby setup differences:

1. Install Docker Desktop
2. Run `docker build -t gathertray .`
3. Run `docker run --rm -p 4567:4567 gathertray`
4. Open `http://127.0.0.1:4567`

For the smoothest repeated handoff across multiple PCs, use `docker compose up --build` so the app runs with a persistent data volume and the correct bind address automatically.

For developers who want to edit code directly, Git is the better path.

## Mobile preview

1. Keep the API running with `ruby server.rb`
2. Open the `mobile/` folder
3. Run `npm install`
4. Run `npm run start`
5. Open the project in iOS Simulator, Android Emulator, or Expo Go

## Demo accounts

- Admin: `admin@gathertray.local` / `admin123`
- Customer: `buyer@gathertray.local` / `buyer123`
- Restaurant: `bhatel@gathertray.local` / `restaurant123`

## Core API endpoints

- `GET /api/health`
- `GET /api/bootstrap`
- `GET /api/restaurants`
- `PUT /api/restaurants/:slug`
- `POST /api/restaurants/:slug/import-menu`
- `GET /api/orders`
- `GET /api/orders/:id`
- `POST /api/orders`
- `PUT /api/orders/:id`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `POST /api/auth/signup`
- `GET /api/account`
- `PUT /api/account`
- `GET /api/account/orders`
- `PUT /api/account/password`
- `GET /api/account/notifications`
- `GET /api/account/sessions`
- `POST /api/account/sessions/revoke-others`
- `POST /api/account/sessions/:id/revoke`
- `GET /api/favorites`
- `POST /api/favorites`
- `GET /api/saved-searches`
- `POST /api/saved-searches`
- `DELETE /api/saved-searches/:id`
- `GET /api/issues`
- `POST /api/issues`
- `PUT /api/issues/:id`
- `GET /api/reviews`
- `POST /api/reviews`
- `GET /api/restaurant-applications`
- `POST /api/restaurant-applications`
- `POST /api/restaurant-applications/:id/approve`
- `POST /api/restaurant-applications/:id/reject`
- `GET /api/export/orders.csv`
- `GET /api/export/backup.json`
- `GET /api/backups`
- `POST /api/backups`
- `GET /api/backups/:filename`

## Honest remaining gaps before a true public launch

1. Replace JSON file storage with a real database and migrations
2. Move from local token/password handling to production-grade auth
3. Add Stripe checkout, payouts, refunds, and fee reporting
4. Move uploads to cloud object storage
5. Add transactional email and SMS delivery
6. Deploy on production infrastructure with monitoring and backups
7. Build dedicated iOS and Android apps against the same API
