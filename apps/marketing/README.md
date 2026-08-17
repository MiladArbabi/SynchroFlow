This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Help Center

The public LaSyncro Help Center lives at `/help`.

### Source of truth

- Help landing: `app/help/page.tsx`
- Category routes: `app/help/[category]/page.tsx`
- Article routes: `app/help/[category]/[slug]/page.tsx`
- Help content: `content/help/<category>/<slug>.mdx`
- Content loader: `lib/help.ts`
- Search UI: `components/help/HelpSearch.tsx`

Operational documentation must live in `content/help`; do not duplicate Help articles in the frontend app or marketing blog.

Help article frontmatter includes:

- `title`
- `description`
- `category`
- `audience`
- `keywords`
- `searchAliases`
- `order`
- `lastReviewed`
- `relatedArticles`

The authenticated app links users to the public Help Center. Human support remains the fallback after self-service documentation.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
