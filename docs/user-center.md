---
summary: "Manage profiles, organizations, favorites, developer access, AI employees, public pages, and friendly links."
read_when:
  - Updating an account or organization avatar
  - Applying for developer access or managing AI employees
  - Sharing a public profile page
  - Maintaining footer friendly links
---

# User center and public profiles

Open `/dashboard` after signing in. The dashboard is the account overview and the stable entry point for personal settings, organization settings, favorites, the public AI employee catalog, wallet and billing, and the user's public profile.

## My favorites

Open `/stars` from the dashboard's **我的收藏** entry to review saved skills. You can switch between grid and list views, sort the complete saved set, and remove a saved skill without leaving the page.

## Personal profile and avatar

Open `/settings` to:

- Upload a local PNG, JPEG, WebP, or GIF image as the account avatar. The file must be an image smaller than 5 MB.
- Edit the display name and public introduction.
- Choose a unique public profile suffix using 3–40 lowercase letters, numbers, or hyphens.
- Open the resulting `/profile/<suffix>` page.

The avatar form uploads the selected file to managed storage. Users do not need to host an image or paste an avatar URL.

## Public profile

`/profile/<suffix>` is public and does not require sign-in. It shows only selected public account fields and the user's currently published and available AI employees.

The page does not expose email addresses, phone numbers, authentication data, private or unpublished AI employees, moderation records, organization-private data, wallet balances, or billing history.

## Organization profile

Open `/settings?view=organizations` to create or update an organization. The organization form uses these labels:

- **Company name (English)**: the stable URL-safe organization identifier. The placeholder is `请输入公司英文名`.
- **Company name (Chinese)**: the organization display name. The placeholder is `请输入公司中文名`.
- **Company avatar**: a local image upload with the same 5 MB limit as the personal avatar.

Only organization owners and administrators can change the organization profile or avatar. Avatar URL fields are not part of the user-facing organization flow.

## Developer access and AI employees

The developer center is available from `/dashboard`.

- A regular user must apply for developer access before creating AI employees.
- An approved developer can create an AI employee and view owned AI employees in the same center.
- The dashboard continues to expose the public AI employee catalog at `/recruit-ai`.
- `/recruit-ai` shows the public catalog both before and after sign-in. Signing in adds hiring actions; it does not replace or hide the catalog.

## Friendly links

Enabled friendly links are displayed in the public site footer. Administrators can open `/management?view=friendly-links` to:

- Add a link name, HTTP or HTTPS URL, optional description, and sort order.
- Edit, enable, disable, or delete a link.
- Preview the target in a new browser tab.

Only users with the `admin` role can write friendly-link configuration. Moderators and regular users cannot use the management API. Lower sort values appear first, and disabled links are not returned to public visitors.

The footer keeps a small read-only fallback list only while the API or its database migration is unavailable. A successful API response containing an empty list is respected as an intentional administrator configuration.
