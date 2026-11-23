import net from "node:net";

/**
 * Node tries IPv6 and IPv4 addresses in turn and gives each connection attempt only 250 ms. The
 * production container has no IPv6 route, and on a slow home link the IPv4 handshake to MakerWorld
 * can take longer than that, so every attempt was cut off and fetch failed while curl worked.
 */
net.setDefaultAutoSelectFamilyAttemptTimeout(2500);
