# Work Order: Goldie Web - Fix Web Compatibility Issues

## Goal
Fix all web compatibility issues in the Goldie Health mobile app's web version so the main pages (Patients, Tasks, Resources, Profile) are functional and look clean in a desktop browser.

## Repo
`/home/chris/.openclaw/workspace/goldie-health-mobile-test/`

## Run the app
```bash
cd /home/chris/.openclaw/workspace/goldie-health-mobile-test && npm run web
```
App runs at http://localhost:8081. Login with "Dev Sign In" button.

## Take screenshots to verify your work
Use this Puppeteer setup (already installed at /tmp/node_modules):
```bash
cd /tmp && node -e "
const puppeteer = require('puppeteer-core');
// ... launch with executablePath: '/usr/bin/google-chrome-stable', headless: true, args: ['--no-sandbox']
// screenshot to /home/chris/.openclaw/workspace-cso/goldie-*.png
"
```

## Issues to Fix (Priority Order)

### Critical — App Crashes
1. **~26 files use `react-native-reanimated` or `useAnimatedValue`** which don't work on web
   - Files using `react-native-reanimated`: See `grep -rn "react-native-reanimated\|useAnimatedValue" --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v ".web."`
   - Create `.web.tsx` versions using CSS animations or React Native Web's `Animated` API
   - Already fixed: `components/loader/Loader.web.tsx` (use as reference)

2. **Tasks crash**: `(task.assignedTo ?? []).map is not a function`
   - Likely `task.assignedTo` is a string or object instead of array on web
   - Find in tasks service and add proper type checking

### High — Navigation & Functionality
3. **Sidebar navigation doesn't work** — clicking Tasks, Resources, Profile doesn't navigate
   - Check how nav items use `router.navigate()` or `Link` — may need web-specific handling
   - The app stays on `/patients` when clicking other nav items

4. **CORS headers** — Already fixed in `services/httpClient.ts` (strips `x-goldie-*` headers on web)
   - Verify this is working. If other CORS issues appear, extend the interceptor.

### Medium — UI/Layout Polish
5. **Profile avatar clipping** in sidebar — extends beyond sidebar bounds
6. **No active state indicator** on sidebar nav items — can't tell which page you're on
7. **"Messages" header but "Patient List is Empty"** text mismatch on home page
8. **"Alerts" nav item clipped** by bottom bar
9. **Push notification error** on web — suppress gracefully (check `typeof document !== 'undefined'` before requesting push permissions)

## Architecture Notes
- This is an Expo/React Native app with web support via `expo start --web`
- Platform-specific files use `.web.tsx` / `.web.ts` extensions (Metro resolves automatically)
- Existing web shims: `app/(auth)/sign-in.web.tsx`, `components/auth/AuthContainer.web.tsx`, `components/bottomDialog/BottomDialog.web.tsx`, etc.
- The app uses NativeBase for UI components
- Auth uses Cognito via `services/auth/auth.service.ts`

## Definition of Done
- [ ] App loads without crashes on all main pages (Patients, Tasks, Messages, Resources, Profile)
- [ ] Sidebar navigation works — clicking each item navigates to correct page
- [ ] No console errors except minor warnings
- [ ] Layout looks reasonable on desktop (1280x800 viewport)
- [ ] All changes are web-only (.web.tsx files or `typeof document` guards) — do NOT break Android/iOS

## Out of Scope
- Pixel-perfect design polish
- Mobile-responsive web layout
- New features
- Backend/API changes

## Test / Verify
- Run `npm run web`, open http://localhost:8081
- Click "Dev Sign In"
- Navigate to each page via sidebar
- Check browser console for errors
- Take screenshots with Puppeteer to verify layout
