// Clerk issues Convex JWTs from the "convex" JWT template on clerk.vedantb.com.
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN ?? 'https://clerk.vedantb.com',
      applicationID: 'convex',
    },
  ],
};
