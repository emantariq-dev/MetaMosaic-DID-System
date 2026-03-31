module.exports = {
  networks: {
    // 🟢 Dashboard / MetaMask network (port 8545)
    development: {
      host: "127.0.0.1",
      port: 8545,               // CLI Ganache or GUI if configured
      network_id: "*",
      gas: 8000000,
      gasPrice: 20000000000,    // 20 Gwei
    },

    // 🧪 Metrics / Load testing network (port 8546)
    loadtest: {
      host: "127.0.0.1",
      port: 8546,               // second Ganache instance
      network_id: "*",
      gas: 30000000,            // high block gas limit
      gasPrice: 20000000000,
    },
  },

  compilers: {
    solc: {
      version: "0.8.20",
      settings: {
        optimizer: {
          enabled: true,
          runs: 200,
        },
      },
    },
  },

  mocha: {
    timeout: 100000,
  },
};

