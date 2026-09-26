import { SignedIn, SignedOut, SignInButton, UserButton } from '@clerk/clerk-react';
import { useConvexAuth, useMutation, useQuery } from 'convex/react';
import { anyApi } from 'convex/server';

// Function references by name, so the demo does not depend on `convex/_generated`.
const api = anyApi;

interface Props {
  headSha: string | null;
  cloudSha: string | null;
  onUseCloudSha: (sha: string | null) => void;
}

interface CloudRecord {
  sha: string;
  notes?: string;
  updatedAt: number;
}

function SignedInBaseline({ headSha, cloudSha, onUseCloudSha }: Props) {
  const { isAuthenticated } = useConvexAuth();
  const record = useQuery(api.baselines.get, isAuthenticated ? {} : 'skip') as CloudRecord | null | undefined;
  const save = useMutation(api.baselines.set);
  const using = cloudSha !== null && cloudSha === record?.sha;

  return (
    <>
      <span>
        Cloud: <code data-testid="cloud-sha">{record?.sha ? record.sha.slice(0, 12) : 'none'}</code>
      </span>
      <button type="button" disabled={!isAuthenticated || !headSha} onClick={() => headSha && save({ sha: headSha })}>
        Save HEAD to Convex
      </button>
      <label>
        <input
          type="checkbox"
          disabled={!record?.sha}
          checked={using}
          onChange={(e) => onUseCloudSha(e.target.checked && record?.sha ? record.sha : null)}
        />{' '}
        Diff vs cloud
      </label>
      <UserButton />
    </>
  );
}

export function CloudBaseline(props: Props) {
  return (
    <>
      <SignedOut>
        <SignInButton mode="modal">
          <button type="button">Sign in to sync</button>
        </SignInButton>
      </SignedOut>
      <SignedIn>
        <SignedInBaseline {...props} />
      </SignedIn>
    </>
  );
}
