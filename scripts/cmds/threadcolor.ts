module.exports = {
    config: {
        name: "changecolor",
        aliases: ["color", "threadcolor"],
        version: "2.0",
        author: "Priyanshi Kaur",
        countDown: 5,
        role: 1,
        shortDescription: "Change group chat color",
        longDescription: "Change the color of the group chat using predefined color options or view the list of available colors",
        category: "group",
        guide: {
            en: "{p}changecolor <color>\n{p}changecolor list [page]\n{p}changecolor random\n\nExamples:\n{p}changecolor HotPink\n{p}changecolor list 2\n{p}changecolor random"
        }
    },
    onStart: async function ({ api, event, args, message }) {
        const threadID = event.threadID;
        const colors = {
            DefaultBlue: "196241301102133", HotPink: "169463077092846", AquaBlue: "2442142322678320",
            BrightPurple: "234137870477637", CoralPink: "980963458735625", Orange: "175615189761153",
            Green: "2136751179887052", LavenderPurple: "2058653964378557", Red: "2129984390566328",
            Yellow: "174636906462322", TealBlue: "1928399724138152", Aqua: "417639218648241",
            Mango: "930060997172551", Berry: "164535220883264", Citrus: "370940413392601",
            Candy: "205488546921017", Earth: "1833559466821043", Support: "365557122117011",
            Music: "339021464972092", Pride: "1652456634878319", DoctorStrange: "538280997628317",
            LoFi: "1060619084701625", Sky: "3190514984517598", LunarNewYear: "357833546030778",
            Celebration: "627144732056021", Chill: "390127158985345", StrangerThings: "1059859811490132",
            Dune: "1455149831518874", Care: "275041734441112", Astrology: "3082966625307060",
            JBalvin: "184305226956268", Birthday: "621630955405500", Cottagecore: "539927563794799",
            Ocean: "736591620215564", Love: "741311439775765", TieDye: "230032715012014",
            Monochrome: "788274591712841", Default: "3259963564026002", Rocket: "582065306070020",
            Berry2: "724096885023603", Candy2: "624266884847972", Unicorn: "273728810607574",
            Tropical: "262191918210707", Maple: "2533652183614000", Sushi: "909695489504566",
            Citrus2: "557344741607350", Lollipop: "280333826736184", Shadow: "271607034185782",
            Rose: "1257453361255152", Lavender: "571193503540759", Tulip: "2873642949430623",
            Classic: "3273938616164733", Peach: "3022526817824329", Honey: "672058580051520",
            Kiwi: "3151463484918004", Grape: "193497045377796", NonBinary: "737761000603635",
            ThankfulForFriends: "1318983195536293", Transgender: "504518465021637",
            TaylorSwift: "769129927636836", NationalComingOutDay: "788102625833584",
            Autumn: "822549609168155", Cyberpunk2077: "780962576430091", MothersDay: "1288506208402340",
            APAHM: "121771470870245", Parenthood: "810978360551741", StarWars: "1438011086532622",
            GuardianOfTheGalaxy: "101275642962533", Bloom: "158263147151440",
            BubbleTea: "195296273246380", Basketball: "6026716157422736",
            ElephantsAndFlowers: "693996545771691"
        };
        const colorList = Object.keys(colors);
        if (!args[0]) {
            return message.reply("Please provide a color name, 'list', or 'random'. Use the command guide for more information.");
        }
        if (args[0].toLowerCase() === "list") {
            const itemsPerPage = 20;
            const page = parseInt(args[1]) || 1;
            const startIndex = (page - 1) * itemsPerPage;
            const endIndex = startIndex + itemsPerPage;
            const colorSubset = colorList.slice(startIndex, endIndex);
            if (colorSubset.length === 0) {
                return message.reply("Invalid page number.");
            }
            const colorListMessage = colorSubset.join(", ");
            const totalPages = Math.ceil(colorList.length / itemsPerPage);
            return message.reply(`Available colors (Page ${page}/${totalPages}):\n\n${colorListMessage}\n\nUse '${this.config.name} list <page number>' to see more colors.`);
        }
        if (args[0].toLowerCase() === "random") {
            const randomColor = colorList[Math.floor(Math.random() * colorList.length)];
            args[0] = randomColor;
        }
        const colorName = args[0];
        const colorValue = colors[colorName];
        if (!colorValue) {
            return message.reply("Invalid color name. Use 'list' to see available colors.");
        }
        try {
            await api.changeThreadColor(colorValue, threadID);
            return message.reply(`Successfully changed the group chat color to ${colorName}.`);
        }
        catch (error) {
            console.error(error);
            return message.reply("An error occurred while changing the group chat color. Please try again later.");
        }
    }
};
