export default async function Doc({ params }) {
  const { slug } = await params;
  return (
    <main>
      <h1>Docs: {slug.join(' / ')}</h1>
    </main>
  );
}
