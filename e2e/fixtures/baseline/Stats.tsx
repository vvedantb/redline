const cards = [
  { label: 'Components', value: '12' },
  { label: 'Changed', value: '3' },
  { label: 'Reviewers', value: '2' },
];

export function Stats() {
  return (
    <section id="stats" className="stats" data-testid="stats">
      {cards.map((card) => (
        <div key={card.label} className="card">
          <div className="card-value">{card.value}</div>
          <div className="card-label">{card.label}</div>
        </div>
      ))}
    </section>
  );
}
