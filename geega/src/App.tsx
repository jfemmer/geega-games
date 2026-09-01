import "./App.css";
import SignupForm from "./SignupForm";

export default function App() {
  const year = new Date().getFullYear();

  return (
    <div className="page">
      <header className="shell masthead">
        <div className="mark">Geega<span>.</span></div>
        <nav>Magic: The Gathering</nav>
      </header>

      <main className="shell hero reveal">
        <span className="status">
          <span className="dot" aria-hidden="true" />
          Payment processing in progress
        </span>

        <h1 className="display">
          The shop is <span className="foil">shuffling up</span>.
        </h1>

        <p className="lede">
          Geega Games is bringing its Magic: The Gathering singles online — buy,
          sell, and trade. We’re finishing checkout and payment processing now.
          Join the list and you’ll be first through the door.
        </p>

        <SignupForm />
      </main>

      <footer className="shell foot">
        <span>© {year} Geega Games</span>
        <span>Opening soon</span>
      </footer>
    </div>
  );
}
