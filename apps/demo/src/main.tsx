import { ClerkProvider, useAuth } from '@clerk/clerk-react';
import { ConvexReactClient } from 'convex/react';
import { ConvexProviderWithClerk } from 'convex/react-clerk';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

const clerkKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const convexUrl = import.meta.env.VITE_CONVEX_URL;

// Clerk and Convex are optional. Without a publishable key the demo runs in local baseline mode.
const cloud = Boolean(clerkKey && convexUrl);
const convex = cloud ? new ConvexReactClient(convexUrl!) : null;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {cloud && convex ? (
      <ClerkProvider publishableKey={clerkKey!} afterSignOutUrl="/">
        <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
          <App cloud />
        </ConvexProviderWithClerk>
      </ClerkProvider>
    ) : (
      <App cloud={false} />
    )}
  </StrictMode>,
);
