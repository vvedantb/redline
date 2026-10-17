export default function Button({ children }) {
  return (
    <button style={{ padding: '14px 28px', borderRadius: 999, border: 0, background: '#e11d48', color: '#fff', fontSize: 18, fontWeight: 700 }}>
      {children}
    </button>
  );
}
