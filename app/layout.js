import './globals.css';
import Navbar from '../components/Navbar';
import { ToastProvider } from '../components/Feedback';

export const metadata = {
  title: 'CultAnime',
  description: 'A self-hosted anime streaming platform with a premium viewing experience.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body suppressHydrationWarning>
        <ToastProvider>
          <Navbar />
          <main>{children}</main>
          <footer className="footer">
            <p>cultAnime &copy; {new Date().getFullYear()} — Self-hosted anime streaming</p>
          </footer>
        </ToastProvider>
      </body>
    </html>
  );
}
