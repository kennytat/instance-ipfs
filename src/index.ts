import * as fs from 'fs'
import 'dotenv/config'
import * as path from 'path'
import process from 'process';
import { exec, execSync, spawn } from 'child_process'
import PQueue from 'p-queue';
import M3U8FileParser from 'm3u8-file-parser';
import * as os from 'os';
import bitwise from 'bitwise';
// edit info here
const args = process.argv.slice(2)
const fileType = args[0]; // 'audio' | 'video';
const concurrency = parseInt(args[1].replace('concurrency=', '')) || 1;
const startPoint = parseInt(args[2].replace('start=', ''));
const endPoint = parseInt(args[3].replace('end=', ''));
const VGM = fileType === 'audio' ? 'VGMA' : fileType === 'video' ? 'VGMV' : undefined; // 'VGMV' 'VGMA'
const queue = new PQueue({ concurrency: concurrency });
const txtPath = `${__dirname}/database/${fileType}Single.txt`;
const cloudPath = `vgm-aliyun:vgm/output/${VGM}`; // `converted-vgm-local:vgm-converted/encrypted/${VGM}`// `vgm-aliyun:vgm/output/${VGM}`;  // `VGM-Converted:vgmencrypted/encrypted/${VGM}`; 
// const mountedInput = `${__dirname}/database/mountedInput/${VGM}`; // `${__dirname}/database/mountedInput/${VGM}`;  `/mnt/ntfs/VGMEncrypted/${VGM}`   
const localPath = `/mnt/data/converted/${VGM}`
// const downloadTemp = `${os.tmpdir()}/${VGM}`; // `/home/vgm/Desktop/VGMEncrypted/${VGM}`  `/mnt/ntfs/VGMEncrypted/${VGM}`   `${__dirname}/database/tmp/${VGM}`;
const localTemp = `${os.tmpdir()}/VGM`;
const carStorage = `converted-vgm-local:vgm-converted/VGM`
const ipfsGateway = 'https://api-ipfs-vn.hjm.bid';
// edit info end

const rcloneCopy = async (inPath, outPath) => {
	console.log('download converted file', `${inPath}`, `${outPath}`);
	return new Promise(async (resolve) => {
		// const startDownload = () => {
		const rclone = spawn('rclone', ['copy', '--progress', `${inPath}`, `${outPath}`]);
		rclone.stdout.on('data', async (data) => {
			console.log(`rclone copy stdout: ${data}`);
		});
		rclone.stderr.on('data', async (data) => {
			console.log(`Stderr: ${data}`);
		});
		rclone.on('close', async (code) => {
			console.log(`Rclone copy done with code:`, code);
			resolve(true);
		})
	});
}


const packCar = async (input, output) => {
	console.log('packing Car:', input, output);
	return new Promise(async (resolve, reject) => {
		if (!fs.existsSync(output)) {
			await execSync(`ipfs-car --wrapWithDirectory false --pack ${input} --output ${output}`);
			console.log('packed car done');
		}
		resolve(true);
	})
}


const uploadIPFS = async (carPath) => {
	console.log('uploadingIPFS:', carPath);
	console.time(path.parse(carPath).name)
	return new Promise(async (resolve) => {
		try {
			// add via dag import
			exec(`curl -X POST -F file=@${carPath} "${ipfsGateway}/add?format=car&stream-channels=false"`, async (err, stdout, stderr) => {
				if (stdout) {
					const cid = JSON.parse(stdout)[0].cid;
					console.timeEnd(path.parse(carPath).name)
					await fs.unlinkSync(carPath);
					resolve(cid.toString());
				}
				if (err) {
					console.timeEnd(path.parse(carPath).name)
					await fs.unlinkSync(carPath);
					resolve(false);
				}
			})

		} catch (error) {
			console.log(error);
			resolve(false);
		}

	});
}

const processFile = async (file: string, fType) => {
	console.log('processing:', file);
	return new Promise(async (resolve) => {
		try {
			const fileLocation = file.replace(/\./g, '\/');
			// // download from s3 to local
			const src = `${cloudPath}/${fileLocation}`;
			const des = `${localPath}/${fileLocation}`;
			// const downloadTmpDir = `${downloadTemp}/${fileLocation}`; // `${localTemp}/${cloudPath}`; // `${localTemp}/${file}`;
			const downloaded = await rcloneCopy(`${src}/`, `${des}/`);
			// // // mounted directly from s3
			// const downloadTmpDir = `${mountedInput}/${cloudPath}`; 

			// get decrypted key hash and upload to ipfs
			// get iv info
			if (downloaded) {
				// // upload encrypted from car
				const encryptedCarPath = `${localTemp}/${path.basename(des)}-encrypted.car`;
				await packCar(des, encryptedCarPath);
				await rcloneCopy(encryptedCarPath, `${carStorage}/`);
				const encryptedCID: any = await uploadIPFS(encryptedCarPath);
				// decrypte key && edit m3u8
				const keyPath: string = fType === 'audio' ? `${des}/128p.m3u8` : `${des}/480p.m3u8`;
				const reader = new M3U8FileParser();
				const segment = await fs.readFileSync(keyPath, { encoding: 'utf-8' });
				reader.read(segment);
				const m3u8 = reader.getResult();
				const secret = `VGM-${m3u8.segments[0].key.iv.slice(0, 6).replace("0x", "")}`;
				const code = Buffer.from(secret);
				const key: Buffer = await fs.readFileSync(`${des}/key.vgmk`);
				const encrypted = bitwise.buffer.xor(key, code, false);

				// // upload decrypted from car
				const decryptedTempDir = `${localTemp}/${path.basename(des)}-decrypted`;
				const decryptedCarPath = `${localTemp}/${path.basename(des)}-decrypted.car`;
				await execSync(`bash symlink.sh "${des}" "${decryptedTempDir}"`);

				const keyTmpPath = `${decryptedTempDir}/key.vgmk`;
				await fs.writeFileSync(keyTmpPath, encrypted, { encoding: 'binary' });
				await packCar(decryptedTempDir, decryptedCarPath);
				await fs.rmSync(decryptedTempDir, { recursive: true })
				// then upload decrypted to ipfs
				const decryptedCID: any = await uploadIPFS(decryptedCarPath);
				if (encryptedCID && decryptedCID) {
					// // rm downloaded directory when finish - comment if keep
					// await fs.rmSync(des, { recursive: true })
					// console.log('removed downloadTmpDir');
					resolve(`${encryptedCID.toString()}|${decryptedCID.toString()}`)
				}
				// resolve('done123')
			} else {
				resolve(false);
			}

		} catch (error) {
			resolve(false)
			console.log('error:', error);
		}
	})
};

const main = async () => {
	try {
		// start script here
		const raw = fs.readFileSync(txtPath, { encoding: 'utf8' });
		if (raw) {
			let list = raw.split('\n');
			list.pop();
			console.log('total files', list.length);
			const listLength = endPoint ? endPoint : list.length;
			for (let i = startPoint; i < listLength; i++) { // list.length or endPoint
				(async () => {
					queue.add(async () => {
						console.log('Processing file:', list[i]);
						const start = new Date();
						const startTime = start.getFullYear() + '-' + (start.getMonth() + 1) + '-' + start.getDate() + '|' + start.getHours() + ":" + start.getMinutes() + ":" + start.getSeconds();
						const result = await processFile(list[i], fileType);
						const end = new Date();
						const endTime = end.getFullYear() + '-' + (end.getMonth() + 1) + '-' + end.getDate() + '|' + end.getHours() + ":" + end.getMinutes() + ":" + end.getSeconds();
						//   console.log('processed files', i, dateTime);
						if (result) {
							await fs.appendFileSync(`${__dirname}/database/${fileType}-ipfs-count.txt`, `\n${i}|${list[i]}|${result}|${startTime}|${endTime}`);
						} else {
							await fs.appendFileSync(`${__dirname}/database/${fileType}-ipfs-count.txt`, `\n${i}|notfound|${list[i]}`);
						}
					});
				})();
			}
		}
	} catch (error) {
		console.log(error);
	}
}

main();
