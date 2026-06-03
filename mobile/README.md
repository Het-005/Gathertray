# GatherTray Mobile

This is the first Expo-based mobile scaffold for GatherTray. It is designed to become the shared iOS and Android app layer while the Ruby backend remains the common API for web and mobile.

## What is included

- Expo app shell
- Shared API client for the current GatherTray backend
- Marketplace preview from `/api/bootstrap`
- Budget-first marketplace filtering for mobile buyers
- Demo customer login using `/api/auth/login`
- Mobile order request creation using `/api/orders`
- Customer order history from `/api/account/orders`
- Notifications feed from `/api/account/notifications`
- Customer favorites synced from `/api/favorites`
- Customer saved searches synced from `/api/saved-searches`
- Restaurant and admin mobile views powered by role-scoped `/api/bootstrap` data
- Restaurant and admin mobile order status actions using `/api/orders/:id`
- SecureStore-backed mobile session persistence for restored sign-in state
- Mobile profile and password management using `/api/account`
- Local mobile persistence for search filters and order drafts
- Mobile order detail review plus support ticket creation using `/api/issues`
- Mobile review submission for completed customer orders using `/api/reviews`
- Mobile order timeline views built from order, issue, review, and notification history
- Local unread/read state for mobile notifications to support push-ready alert behavior
- Notification tap-through into related order context for faster mobile triage
- Structured notification metadata for more reliable mobile routing and timeline matching

## Run locally

1. Start the GatherTray API from the project root with `ruby server.rb`
2. In this `mobile` folder, run `npm install`
3. Run `npm run start`
4. Open in the iOS simulator, Android emulator, or Expo Go

## Important note for physical devices

`src/api.js` currently points to `http://127.0.0.1:4567`, which works for simulators on the same machine. For a physical phone, replace that base URL with your computer's LAN IP.

## Next mobile steps

1. Add proper navigation and deeper role-aware flows
2. Add push notifications
3. Add native deep links and external routing
4. Add device-tested polish for role handoffs and edge states
5. Add live push delivery once a production notification provider is chosen
