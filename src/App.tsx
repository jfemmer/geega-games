import "./App.css";
import SignupForm from "./SignupForm";
import logo from "/logo.png";

export default function App() {
  const year = new Date().getFullYear();

  return (
    <div className="page">
      <main className="shell hero reveal">
        <img
          className="logo"
          src={logo}
          alt="Geega Games"
          width={686}
          height={606}
        />

        <span className="status">
          <span className="dot" aria-hidden="true" />
          Payment processing in progress
        </span>

        <h1 className="display">The shop is shuffling up.</h1>

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