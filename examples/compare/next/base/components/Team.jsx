const people = ['Ada, engineering', 'Grace, design', 'Linus, support'];

export default function Team() {
  return people.map((p) => (
    <div className="card" key={p}>
      {p}
    </div>
  ));
}
