import './globals.css';
import Navbar from '../components/Navbar';

export const metadata = {
  title: 'CultAnime',
  description: 'A self-hosted anime streaming platform with a premium viewing experience.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>
        <Navbar />
        <main>{children}</main>
        <footer className="footer">
          <p>cultAnime &copy; {new Date().getFullYear()} — Self-hosted anime streaming</p>
        </footer>
      </body>
    </html>
  );
}
