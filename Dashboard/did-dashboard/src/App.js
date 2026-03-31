import React, { useEffect, useState } from "react";
import Dashboard from "./components/Dashboard";
import { initWeb3 } from "./web3";

function App() {
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    const initialize = async () => {
      await initWeb3();
      setInitialized(true);
    };
    initialize();
  }, []);

  return (
    <div>
      {initialized ? (
        <Dashboard />
      ) : (
        <h4 style={{ textAlign: "center", marginTop: "50px" }}>
          Connecting to Web3 and smart contracts...
        </h4>
      )}
    </div>
  );
}

export default App;
