export default function Button({ children }) {
  return (
    <button style={{ padding: '10px 18px', borderRadius: 6, border: 0, background: '#2563eb', color: '#fff', fontSize: 15 }}>
      {children}
    </button>
  );
}
