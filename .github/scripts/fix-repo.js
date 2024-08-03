const fs = require("fs");
const path = require("path");
const axios = require("axios");
const parseMidi = require("midi-file").parseMidi;
const { Midi } = require("@tonejs/midi");

const invalid_chars = [
  ":", "/", "\'", "\"", "?", "#", "%", "&", "{", "}", "\\", "<", ">", "*", "$",
  "!", "@", "+", "`", "|", "=", "."
];

function filterFilename(name) {
  if (!name) {
      return ""
  }
  invalid_chars.forEach((c) => {
    name = name.split("").filter((i) => i !== c).join("");
  });
  return name;
}

function adjustRawURL(input_url) {
    return input_url.replace("github.com","raw.githubusercontent.com").replace("raw/","")
}

async function fixRepoFromPR(pr_number, api_pr_resp, api_files_resp) {
    // Set file variables
    let bin_file = null;
    let midi_file = null;
    let midi_raw_file = null;
    let preview_file = null;
    let preview_extension = null;
    const preview_extensions = ["wav", "mp3"];
    for (i = 0; i < api_files_resp.data.length; i++) {
      const f = api_files_resp.data[i];
      if (f.filename) {
        const extension_sep = f.filename.split(".");
        const extension = extension_sep[extension_sep.length - 1];
        if (extension == "bin") {
          bin_file = f.filename;
        } else if (extension == "mid") {
          midi_file = f.filename;
          midi_raw_file = f.raw_url;
        } else if (preview_extensions.includes(extension)) {
          preview_file = f.filename;
          preview_extension = extension;
        }
      }
    }
    console.log(bin_file, midi_file, preview_file, preview_extension)

    // Extract the PR message
    const prMessage = api_pr_resp.data.body;
    const rawPRData = prMessage ? prMessage.split("\r\n") : []
    const REQ_STRING = "IS SONG - DO NOT DELETE THIS LINE"
    if (rawPRData[0] != REQ_STRING) {
        console.log("Skipping Pull Request, missing key line.");
        return;
    }
    let json_output = {}
    rawPRData.forEach((item, index) => {
        if ((index > 0) && (item)) {
            if (item.split("").includes(":")) {
              spl = item.split(/:(.*)/s)
              json_output[spl[0].trim()] = spl[1].trim()
            }
        }
    })
    console.log("Detected Data:")
    console.log(json_output)
    const number_vars = ["Tracks", "Duration"]
    number_vars.forEach((v) => {
        if (Object.keys(json_output).includes(v)) {
            if (!isNaN(json_output[v])) {
                json_output[v] = Number(json_output[v])
            }
        }
    })
    const arr_vars = ["Tags"]
    arr_vars.forEach((v) => {
        if (Object.keys(json_output).includes(v)) {
          if (json_output[v]) {
            json_output[v] = json_output[v].split(",").map((item) => item.trim())
          }
        }
    })
    json_output["Verified"] = true;
    dt = new Date();
    json_output["Date"] = dt.toString();
    // Read the existing JSON file
    console.log(__dirname)
    const file = "mapping.json"
    const filePath = path.join(__dirname, `../../${file}`);
    const existingData = fs.existsSync(filePath) ? require(filePath) : [];
    // Get new file name
    let revisions = existingData.filter((entry) => ((entry["Game"] == json_output["Game"]) && (entry["Song"] == json_output["Song"]))).length;
    const rev_string = revisions == 0 ? "" : ` (REV ${revisions})`;
    const sub_file = `${filterFilename(json_output["Game"])}/${filterFilename(json_output["Song"])}${rev_string}`
    let binary_link = null;
    if (preview_file) {
      json_output["Audio"] = encodeURI(`https://github.com/theballaam96/candys-shop/raw/main/previews/${sub_file}.${preview_extension}`)
    }
    if (bin_file) {
      json_output["Binary"] = `binaries/${sub_file}.bin`
      binary_link = encodeURI(`https://github.com/theballaam96/candys-shop/raw/main/binaries/${sub_file}.bin`)
    }
    console.log(sub_file)

    
    // Read existing file for PR
    console.log("Starting file transfer")
    file_data = {
      "binaries": [bin_file, "bin", true],
      "previews": [preview_file, preview_extension, true],
      "midi": [midi_file, "mid", false],
    }
    let preview_file_bytes = null;
    Object.keys(file_data).forEach((k) => {
      k_file = file_data[k][0];
      k_ext = file_data[k][1];
      k_keep = file_data[k][2];
      if (k_file != null) {
        const binFilePath = path.join(__dirname, `../../${k_file}`);
        if (k_keep) {
          const newBinFile = `${k}/${sub_file}.${k_ext}`
          const rootDir = `${k}`
          const gameDir = `${k}/${filterFilename(json_output["Game"])}`
          if (!fs.existsSync(rootDir)) {
            fs.mkdirSync(rootDir)
          }
          if (!fs.existsSync(gameDir)) {
            fs.mkdirSync(gameDir)
          }
          const binNewFilePath = path.join(__dirname, `../../${newBinFile}`);
          const binFileData = fs.existsSync(binFilePath) ? fs.readFileSync(binFilePath) : null;
          if (k == "previews") {
            preview_file_bytes = binFileData;
          }
          if (binFileData != null) {
            fs.writeFileSync(binNewFilePath, binFileData);
          }
        }
        fs.unlinkSync(binFilePath);
      }
    })
    console.log("File Transfer Done")

    if (midi_file) {
      const midiURL = adjustRawURL(midi_raw_file);
      const midiParsed = await Midi.fromUrl(midiURL);
      if (midiParsed.duration) {
      	json_output["Duration"] = midiParsed.duration;
      }
    }

    console.log("Data written to mapping.json")
    console.log(json_output)

    // Append the PR message to the JSON file
    existingData.push(json_output);

    // Write the updated JSON file
    fs.writeFileSync(filePath, JSON.stringify(existingData, null, 2));

    console.log("PR message appended to JSON file successfully.");
}

async function run() {
  try {
    // Get the PR number
    const repo = "theballaam96/candys-shop";
    const token = process.env.PAT_TOKEN;

    // Get a list of the most recent 20 workflow runs with the PR Merge Workflow
    const action_response = await axios.get(`https://api.github.com/repos/${repo}/actions/workflows/81545140/runs?status=completed&per_page=100`, {
        headers: {
            Authorization: `Bearer ${token}`,
        }
    })
    const home_path = path.join(__dirname, `../../`);
    for (let i = 0; i < action_response.data.workflow_runs.length; i++) {
        const action = action_response.data.workflow_runs[i];
        if (action.conclusion != "failure") {
            continue;
        }
        const head_commit_id = action.head_commit.id;
        console.log(`Attempting to analyze commit ${head_commit_id}`)
        if (!head_commit_id) {
            continue;
        }
        // Get Commit ID data
        const response_commit = await axios.get(`https://api.github.com/repos/${repo}/commits/${head_commit_id}/pulls`, {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });
        const files_in_directory = fs.readdirSync(home_path);
        if (response_commit.data.length == 0) {
            continue;
        }
        const local_pr_number = response_commit.data[0].number;
        console.log(`Attempting to analyze PR #${local_pr_number}`)
        if (!local_pr_number) {
            continue;
        }
        // Get files
        const response_files = await axios.get(`https://api.github.com/repos/${repo}/pulls/${local_pr_number}/files`, {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });
        const pr_files = response_files.data;
        if (pr_files.length > 0) {
            const first_file = response_files.data[0].filename;
            if ((!first_file.includes(".mid")) && (!first_file.includes(".bin")) && (!first_file.includes(".mp3"))) {
                continue;
            }
            const contains_files_in_repo = files_in_directory.includes(first_file)
            if (contains_files_in_repo) {
                const response = await axios.get(`https://api.github.com/repos/${repo}/pulls/${local_pr_number}`, {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                });
                console.log(`Found files in repository that haven't been handled with PR #${local_pr_number}`);
                fixRepoFromPR(local_pr_number, response, response_files);
            }
        }
    }

    // Get the PR details using the GitHub API
    // const response = await axios.get(`https://api.github.com/repos/${repo}/pulls/${prNumber}`, {
    //   headers: {
    //     Authorization: `Bearer ${token}`,
    //   },
    // });
    // console.log(response_files.data);
    
  } catch (error) {
    console.error("Error:", error.response ? error.response.data : error.message || error);
    process.exit(1);
  }
}

run();
