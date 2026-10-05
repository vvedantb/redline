export function generateStaticParams() {
  return [{ slug: 'hello' }];
}

export default async function Post({ params }) {
  const { slug } = await params;
  return (
    <main>
      <h1>Post: {slug}</h1>
      <p>Our first post. It says hello.</p>
    </main>
  );
}
