import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 3000);
createServer((_request, response) => {
	response.end("widget service\n");
}).listen(port, () => {
	console.log(`listening on http://localhost:${port}`);
});
