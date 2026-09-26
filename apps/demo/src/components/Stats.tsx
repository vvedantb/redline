const cards = [
  { label: 'Components', value: '12' },
  { label: 'Changed', value: '3' },
  { label: 'Reviewers', value: '2' },
];

export function Stats() {
  return (
    <section id="stats" className="stats stats--wide" data-testid="stats">
      {cards.map((card) => (
        <div key={card.label} className="card">
          <div className="card-value">{card.value}</div>
          <div className="card-label">{card.label}</div>
        </div>
      ))}
      <div className="card card--accent" data-testid="review-card">
        <div className="card-value">4 min</div>
        <div className="card-label">Review time</div>
      </div>
    </section>
  );
}
