/**
 * Every state's hunting-unit sources: where the agency publishes the boundaries, and how each service's own
 * column names map onto the app's one normalized shape (src/huntUnits/types.ts).
 *
 * Only states whose wildlife agency publishes an official, queryable polygon layer of hunt / management units are
 * listed. Many states regulate by county (or statewide) and have no such layer — see the coverage table in README.
 * `vintage` is only what the agency itself states (a season or a year); an empty string means it states none — the app
 * shows the layer's real last-edited date instead (recorded at build time), never a claim of being "current".
 * Each set's `example` is a real attribute row from the live service; a test checks `map` turns it into the stated
 * unit and title, so a service that renames a column is caught by re-running the build, not by a wrong map.
 *
 * Loaded by tools/build_hunt_units.mjs with node's type stripping, so: no enums, no parameter properties.
 */

import { hrefOf, httpUrl, joinTitle, text, titleCase } from './normalize.ts';
import type { HuntStateConfig } from './types.ts';

const MT = 'https://services3.arcgis.com/Cdxz8r11hT0MGzg1/arcgis/rest/services';
const WY = 'https://services6.arcgis.com/cWzdqIyxbijuhPLw/arcgis/rest/services';
const MI = 'https://services3.arcgis.com/Jdnp1TjADvSDxMAX/arcgis/rest/services/WILDGameSpeciesManagementUnitsAndZonesOPENDATA/FeatureServer';

/** Montana's district layers list reservations, parks and "not a hunting district" polygons too; a real district has a DISTRICT. */
const montanaDistrict = (a: Record<string, any>) => {
  const unit = text(a.DISTRICT);
  return unit ? unit : null;
};

export const HUNT_STATES: HuntStateConfig[] = [
  {
    code: 'AK',
    name: 'Alaska',
    agency: 'Alaska Department of Fish and Game',
    regsUrl: 'https://www.adfg.alaska.gov/index.cfm?adfg=hunting.main',
    vintage: '',
    sets: [
      {
        id: 'gmu',
        label: 'Game Management Units',
        noun: 'Unit',
        layer: 'https://gis.adfg.alaska.gov/ags/rest/services/wc_public/GMUSubunits/MapServer/4',
        map: (a) => (text(a.SubLabel) ? { unit: text(a.SubLabel) } : null),
        example: { attributes: { Region: 1, UnitSub: '01A', SubLabel: '1A' }, unit: '1A', title: 'Unit 1A' },
      },
    ],
  },
  {
    code: 'AR',
    name: 'Arkansas',
    agency: 'Arkansas Game and Fish Commission',
    regsUrl: 'https://www.agfc.com/en/hunting/',
    vintage: '',
    sets: [
      {
        id: 'deer',
        label: 'Deer Management Units',
        noun: 'Deer Management Unit',
        layer: 'https://services.arcgis.com/5bMc8SlGDYGINZr5/arcgis/rest/services/AGFC_Deer_Management_Units/FeatureServer/0',
        map: (a) => {
          const unit = text(a.flabel) || text(a.DMU_Number).replace(/^DMU\s*/i, '');
          if (!unit) return null;
          return { unit, title: joinTitle(`DMU ${unit}`, text(a.fname).replace(/\s*DMU$/i, '')) };
        },
        example: { attributes: { fname: 'Ozark Mountains DMU', flabel: '1', DMU_Number: 'DMU 1' }, unit: '1', title: 'DMU 1 – Ozark Mountains' },
      },
    ],
  },
  {
    code: 'CA',
    name: 'California',
    agency: 'California Department of Fish and Wildlife',
    regsUrl: 'https://wildlife.ca.gov/Hunting',
    vintage: 'Title 14 §360 deer hunt zones (2014 legal description)',
    sets: [
      {
        id: 'deer',
        label: 'Deer Hunt Zones',
        noun: 'Deer Zone',
        layer: 'https://services2.arcgis.com/Uq9r85Potqm3MfRV/arcgis/rest/services/biosds342_fpu/FeatureServer/0',
        map: (a) => (text(a.Zone_Nam) ? { unit: text(a.Zone_Nam), note: 'Approximate legal boundary (Title 14, Section 360)' } : null),
        example: { attributes: { ZONE_LTR: 'B', Zone_Nam: 'B6' }, unit: 'B6', title: 'Deer Zone B6' },
      },
    ],
  },
  {
    code: 'CO',
    name: 'Colorado',
    agency: 'Colorado Parks and Wildlife',
    regsUrl: 'https://cpw.state.co.us/hunting',
    vintage: '',
    sets: [
      {
        id: 'gmu',
        label: 'Game Management Units',
        noun: 'GMU',
        layer: 'https://services5.arcgis.com/ttNGmDvKQA7oeDQ3/ArcGIS/rest/services/CPWAdminData/FeatureServer/6',
        map: (a) => (text(a.GMUID) ? { unit: text(a.GMUID) } : null),
        example: { attributes: { GMUID: 201, COUNTY: 'MOFFAT', DEERDAU: 'D-1', ELKDAU: 'E-1' }, unit: '201', title: 'GMU 201' },
      },
    ],
  },
  {
    code: 'CT',
    name: 'Connecticut',
    agency: 'Connecticut Department of Energy and Environmental Protection',
    regsUrl: 'https://portal.ct.gov/deep/hunting/hunting',
    vintage: '',
    sets: [
      {
        id: 'zone',
        label: 'Deer & Turkey Management Zones',
        noun: 'Deer & Turkey Zone',
        layer: 'https://services1.arcgis.com/FjPcSmEFuDYlIdKC/arcgis/rest/services/Deer_Turkey_Management_Zones/FeatureServer/0',
        map: (a) => (text(a.zone) ? { unit: text(a.zone) } : null),
        example: { attributes: { zone: '1' }, unit: '1', title: 'Deer & Turkey Zone 1' },
      },
    ],
  },
  {
    code: 'FL',
    name: 'Florida',
    agency: 'Florida Fish and Wildlife Conservation Commission',
    regsUrl: 'https://myfwc.com/hunting/',
    vintage: '',
    sets: [
      {
        id: 'deer',
        label: 'Deer Management Units',
        noun: 'Deer Management Unit',
        layer: 'https://gis.myfwc.com/hosting/rest/services/Open_Data/White_tailed_Deer_Management_Unit_Areas/MapServer/4',
        map: (a) => (text(a.DMU) ? { unit: text(a.DMU), note: text(a.Zone) ? `Zone ${text(a.Zone)}` : null } : null),
        example: { attributes: { Unit: 2, DMU: 'C2', Zone: 'C' }, unit: 'C2', title: 'Deer Management Unit C2' },
      },
    ],
  },
  {
    code: 'HI',
    name: 'Hawaii',
    agency: 'Hawaii Division of Forestry and Wildlife',
    regsUrl: 'https://dlnr.hawaii.gov/recreation/hunting/',
    vintage: 'Public hunting areas per HAR Title 13 ch. 122–123 (2015)',
    sets: [
      {
        id: 'unit',
        label: 'Public Hunting Units',
        noun: 'Hunting Unit',
        layer: 'https://geodata.hawaii.gov/arcgis/rest/services/Terrestrial/MapServer/33',
        map: (a) => {
          const name = text(a.unit_name);
          if (!/^Hunting Area/i.test(text(a.status)) || !name) return null; // safety zones and no-hunting areas aren't units
          const unit = name.replace(/^Unit\s+/i, '');
          return { unit, title: joinTitle(name, text(a.descriptio)), note: text(a.status) };
        },
        example: {
          attributes: { unit_name: 'Unit D', mammal_uni: 'D', status: 'Hunting Area (Mammal ONLY)', descriptio: 'Portions of Pupukea-Paumalu F.R.' },
          unit: 'D',
          title: 'Unit D – Portions of Pupukea-Paumalu F.R.',
        },
      },
    ],
  },
  {
    code: 'ID',
    name: 'Idaho',
    agency: 'Idaho Department of Fish and Game',
    regsUrl: 'https://idfg.idaho.gov/rules',
    vintage: '',
    sets: [
      {
        id: 'gmu',
        label: 'Game Management Units',
        noun: 'Unit',
        layer: 'https://services.arcgis.com/FjJI5xHF2dUPVrgK/arcgis/rest/services/GameManagementUnits/FeatureServer/0',
        map: (a) => {
          const name = text(a.NAME);
          if (!name) return null;
          const isUnit = /^\d+[A-Z]?$/.test(name); // Yellowstone (YNP) is in the layer too but isn't a hunt unit
          return {
            unit: name,
            title: isUnit ? `Unit ${name}` : name === 'YNP' ? 'Yellowstone National Park' : name,
            note: text(a.Elk_Zone) ? `Elk zone: ${text(a.Elk_Zone)}` : null,
            url: hrefOf(a.regular_deer_url),
            urlLabel: 'IDFG deer season page',
            url2: hrefOf(a.elkZone_url_1),
            url2Label: 'IDFG elk zone page',
          };
        },
        example: {
          attributes: { NAME: '60A', ID: 77, Elk_Zone: 'Island Park', regular_deer_url: '<a href="https://idfg.idaho.gov/node/76956" target="_top">Unit 60A</a>' },
          unit: '60A',
          title: 'Unit 60A',
        },
      },
    ],
  },
  {
    code: 'KS',
    name: 'Kansas',
    agency: 'Kansas Department of Wildlife and Parks',
    regsUrl: 'https://ksoutdoors.com/Hunting',
    vintage: '',
    sets: [
      {
        id: 'deer',
        label: 'Deer Management Units',
        noun: 'Deer Management Unit',
        layer: 'https://services1.arcgis.com/q2CglofYX6ACNEeu/arcgis/rest/services/Kansas_Deer_Management_Units/FeatureServer/0',
        map: (a) => {
          const unit = text(a.DMU).replace(/^UNIT\s*/i, '');
          return unit ? { unit } : null;
        },
        example: { attributes: { DMU: 'UNIT 8', AreaSQMile: 4426 }, unit: '8', title: 'Deer Management Unit 8' },
      },
    ],
  },
  {
    code: 'KY',
    name: 'Kentucky',
    agency: 'Kentucky Department of Fish and Wildlife Resources',
    regsUrl: 'https://fw.ky.gov/Hunt/Pages/default.aspx',
    vintage: '',
    sets: [
      {
        id: 'deer',
        label: 'Deer Zones',
        noun: 'Deer Zone',
        layer: 'https://services5.arcgis.com/RMHPuOW5MJ6iyTV6/arcgis/rest/services/Deer_Zones/FeatureServer/1',
        dissolveBy: 'CurrentZone', // published per county; a zone is a group of counties
        map: (a) => (text(a.CurrentZone) ? { unit: text(a.CurrentZone) } : null),
        example: { attributes: { NAME: 'OWEN', CurrentZone: 1, FIPS: 187 }, unit: '1', title: 'Deer Zone 1' },
      },
      {
        id: 'elk',
        label: 'Elk Hunting Units',
        noun: 'Elk Unit',
        layer: 'https://services3.arcgis.com/ghsX9CKghMvyYjBU/arcgis/rest/services/Ky_KDFWR_ElkHuntingUnits_WM_gdb/FeatureServer/0',
        map: (a) => (text(a.UnitNumb) ? { unit: text(a.UnitNumb), note: text(a.AreaName) || null } : null),
        example: { attributes: { AreaName: 'Elk Management Zone', UnitNumb: 2, Use_: 'Hunting' }, unit: '2', title: 'Elk Unit 2' },
      },
    ],
  },
  {
    code: 'MA',
    name: 'Massachusetts',
    agency: 'MassWildlife',
    regsUrl: 'https://www.mass.gov/topics/hunting',
    vintage: '',
    sets: [
      {
        id: 'zone',
        label: 'Wildlife Management Zones',
        noun: 'Wildlife Management Zone',
        layer: 'https://services1.arcgis.com/7iJyYTjCtKsZS1LR/arcgis/rest/services/WildlifeManagementZones/FeatureServer/0',
        map: (a) => (text(a.DMZ) ? { unit: text(a.DMZ) } : null),
        example: { attributes: { DMZ: '1', ACRES: 119884.606 }, unit: '1', title: 'Wildlife Management Zone 1' },
      },
    ],
  },
  {
    code: 'ME',
    name: 'Maine',
    agency: 'Maine Department of Inland Fisheries and Wildlife',
    regsUrl: 'https://www.maine.gov/ifw/hunting-trapping/',
    vintage: '',
    sets: [
      {
        id: 'wmd',
        label: 'Wildlife Management Districts',
        noun: 'Wildlife Management District',
        layer: 'https://services1.arcgis.com/RbMX0mRVOFNTdLzd/arcgis/rest/services/WMD/FeatureServer/0',
        map: (a) =>
          text(a.IDENTIFIER)
            ? {
                unit: text(a.IDENTIFIER),
                url: httpUrl(a.MapPDF),
                urlLabel: 'District map (PDF)',
                url2: httpUrl(a.DescriptionPDF),
                url2Label: 'Boundary description (PDF)',
              }
            : null,
        example: {
          attributes: { IDENTIFIER: 3, MapPDF: 'https://www.maine.gov/ifw/docs/wmd/wmd3.pdf' },
          unit: '3',
          title: 'Wildlife Management District 3',
        },
      },
    ],
  },
  {
    code: 'MI',
    name: 'Michigan',
    agency: 'Michigan Department of Natural Resources',
    regsUrl: 'https://www.michigan.gov/dnr/things-to-do/hunting',
    vintage: '2026 units',
    sets: [
      {
        id: 'deer',
        label: 'Deer Management Units',
        noun: 'Deer Management Unit',
        layer: `${MI}/3`,
        map: (a) => {
          const unit = text(a.DeerManagementUnit);
          if (!unit) return null;
          return { unit, title: joinTitle(`DMU ${unit}`, text(a.MangementUnitName).replace(/^DMU-?\d+[A-Z]?\s*/i, '')) };
        },
        example: { attributes: { DeerManagementUnit: '003', MangementUnitName: 'DMU-003 Allegan County' }, unit: '003', title: 'DMU 003 – Allegan County' },
      },
      {
        id: 'bear',
        label: 'Bear Management Units',
        noun: 'Bear Management Unit',
        layer: `${MI}/2`,
        map: (a) => (text(a.ManagementUnitName) ? { unit: text(a.ManagementUnitName) } : null),
        example: { attributes: { ManagementUnitName: 'Amasa' }, unit: 'Amasa', title: 'Bear Management Unit Amasa' },
      },
      {
        id: 'elk',
        label: 'Elk Management Units',
        noun: 'Elk Management Unit',
        layer: `${MI}/4`,
        map: (a) => (text(a.ManagementUnitName) ? { unit: text(a.ManagementUnitName), note: text(a.Season) ? `${text(a.Season)} season` : null } : null),
        example: { attributes: { ManagementUnitName: 'X', Season: 'Winter' }, unit: 'X', title: 'Elk Management Unit X' },
      },
      {
        id: 'turkey',
        label: 'Turkey Management Units',
        noun: 'Turkey Management Unit',
        layer: `${MI}/5`,
        map: (a) => (text(a.ManagementUnit) ? { unit: text(a.ManagementUnit), note: text(a.Season) ? `${text(a.Season)} season` : null } : null),
        example: { attributes: { ManagementUnit: 'NM', Season: 'Spring' }, unit: 'NM', title: 'Turkey Management Unit NM' },
      },
    ],
  },
  {
    code: 'MN',
    name: 'Minnesota',
    agency: 'Minnesota Department of Natural Resources',
    regsUrl: 'https://www.dnr.state.mn.us/hunting/index.html',
    vintage: '2026 deer permit areas',
    sets: [
      {
        id: 'deer',
        label: 'Deer Permit Areas',
        noun: 'Deer Permit Area',
        layer: 'https://enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_dnr/bdry_deer_permit_areas/FeatureServer/0',
        map: (a) => (text(a.dpa) ? { unit: text(a.dpa), note: text(a.management) || null } : null),
        example: { attributes: { dpa: 101, management: 'Two-deer limit' }, unit: '101', title: 'Deer Permit Area 101' },
      },
      {
        id: 'elk',
        label: 'Elk Hunt Zones',
        noun: 'Elk Zone',
        layer: 'https://enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_dnr/bdry_elk_zones/FeatureServer/0',
        map: (a) => (text(a.zone) ? { unit: text(a.zone), title: text(a.descript) || undefined } : null),
        example: { attributes: { zone: 30, descript: 'Kittson County Northeast Elk Zone' }, unit: '30', title: 'Kittson County Northeast Elk Zone' },
      },
    ],
  },
  {
    code: 'MT',
    name: 'Montana',
    agency: 'Montana Fish, Wildlife & Parks',
    regsUrl: 'https://fwp.mt.gov/hunt/regulations',
    vintage: '2026–2027 seasons',
    sets: [
      {
        id: 'deerelk',
        label: 'Deer & Elk Hunting Districts',
        noun: 'Hunting District',
        layer: `${MT}/ADMBND_HD_DEERELKLION/FeatureServer/0`,
        map: (a) => {
          const unit = montanaDistrict(a);
          if (!unit) return null;
          return {
            unit,
            note: text(a.EMU_NAME) || null,
            url: httpUrl(a.DEERWEBPAGE),
            urlLabel: 'FWP deer regulations',
            url2: httpUrl(a.ELKWEBPAGE),
            url2Label: 'FWP elk regulations',
          };
        },
        example: {
          attributes: {
            DISTRICT: '285',
            NAME: '285',
            EMU_NAME: 'Bob Marshall Wilderness Complex',
            DEERWEBPAGE: 'https://myfwp.mt.gov/fwpPub/speciesHuntingGuide?regsSpeciesCd=DEER&district=285',
          },
          unit: '285',
          title: 'Hunting District 285',
        },
      },
      {
        id: 'antelope',
        label: 'Antelope Hunting Districts',
        noun: 'Antelope District',
        layer: `${MT}/ADMBND_HD_ANTELOPE/FeatureServer/0`,
        map: (a) => {
          const unit = montanaDistrict(a);
          return unit ? { unit, url: httpUrl(a.WEBPAGE), urlLabel: 'FWP antelope regulations', url2: httpUrl(a.MAPLINK), url2Label: 'District map (PDF)' } : null;
        },
        example: { attributes: { DISTRICT: '600', NAME: '600', HARVTYPE: 'Special', WEBPAGE: 'https://myfwp.mt.gov/fwpPub/speciesHuntingGuide?regsSpeciesCd=PA&district=600' }, unit: '600', title: 'Antelope District 600' },
      },
      {
        id: 'bear',
        label: 'Black Bear Hunting Districts',
        noun: 'Black Bear District',
        layer: `${MT}/ADMBND_HD_BLACKBEAR/FeatureServer/0`,
        map: (a) => {
          const unit = montanaDistrict(a);
          return unit ? { unit, url: httpUrl(a.WEBPAGE), urlLabel: 'FWP black bear regulations', url2: httpUrl(a.MAPLINK), url2Label: 'District map (PDF)' } : null;
        },
        example: { attributes: { DISTRICT: '130', NAME: '130', HARVTYPE: 'General', WEBPAGE: 'https://fwp.mt.gov/hunt/regulations/black-bear' }, unit: '130', title: 'Black Bear District 130' },
      },
      {
        id: 'moose',
        label: 'Moose Hunting Districts',
        noun: 'Moose District',
        layer: `${MT}/ADMBND_HD_MOOSE/FeatureServer/0`,
        map: (a) => {
          const unit = montanaDistrict(a);
          return unit ? { unit, url: httpUrl(a.WEBPAGE), urlLabel: 'FWP moose regulations', url2: httpUrl(a.MAPLINK), url2Label: 'District map (PDF)' } : null;
        },
        example: { attributes: { DISTRICT: '300', NAME: '300', HARVTYPE: 'Special' }, unit: '300', title: 'Moose District 300' },
      },
      {
        id: 'sheep',
        label: 'Bighorn Sheep Hunting Districts',
        noun: 'Bighorn Sheep District',
        layer: `${MT}/ADMBND_HD_SHEEP/FeatureServer/0`,
        map: (a) => {
          const unit = montanaDistrict(a);
          return unit ? { unit, url: httpUrl(a.WEBPAGE), urlLabel: 'FWP bighorn sheep regulations', url2: httpUrl(a.MAPLINK), url2Label: 'District map (PDF)' } : null;
        },
        example: { attributes: { DISTRICT: '124', NAME: '124', HARVTYPE: 'Special', WEBPAGE: 'https://myfwp.mt.gov/fwpPub/speciesHuntingGuide?regsSpeciesCd=BS&district=124' }, unit: '124', title: 'Bighorn Sheep District 124' },
      },
      {
        id: 'goat',
        label: 'Mountain Goat Hunting Districts',
        noun: 'Mountain Goat District',
        layer: `${MT}/ADMBND_HD_GOAT/FeatureServer/0`,
        map: (a) => {
          const unit = montanaDistrict(a);
          return unit ? { unit, url: httpUrl(a.WEBPAGE), urlLabel: 'FWP mountain goat regulations', url2: httpUrl(a.MAPLINK), url2Label: 'District map (PDF)' } : null;
        },
        example: { attributes: { DISTRICT: '101', NAME: '101', HARVTYPE: 'Special' }, unit: '101', title: 'Mountain Goat District 101' },
      },
    ],
  },
  {
    code: 'ND',
    name: 'North Dakota',
    agency: 'North Dakota Game and Fish Department',
    regsUrl: 'https://gf.nd.gov/hunting',
    vintage: '',
    sets: [
      {
        id: 'deer',
        label: 'Deer Units',
        noun: 'Deer Unit',
        layer: 'https://services1.arcgis.com/GOcSXpzwBHyk2nog/arcgis/rest/services/NDGISHUB_Deer_Units/FeatureServer/0',
        map: (a) => (text(a.UNIT_ID) ? { unit: text(a.UNIT_ID), note: text(a.REGION) ? `${text(a.REGION)} region` : null } : null),
        example: { attributes: { UNIT_ID: '2D', UNIT_TYPE: 'Deer', REGION: 'Red River' }, unit: '2D', title: 'Deer Unit 2D' },
      },
      {
        id: 'elk',
        label: 'Elk Units',
        noun: 'Elk Unit',
        layer: 'https://services1.arcgis.com/GOcSXpzwBHyk2nog/arcgis/rest/services/NDGISHUB_Elk_Units/FeatureServer/0',
        map: (a) => (text(a.UNIT_ID) ? { unit: text(a.UNIT_ID) } : null),
        example: { attributes: { UNIT_TYPE: 'Elk', UNIT_ID: 'E2' }, unit: 'E2', title: 'Elk Unit E2' },
      },
      {
        id: 'moose',
        label: 'Moose Units',
        noun: 'Moose Unit',
        layer: 'https://services1.arcgis.com/GOcSXpzwBHyk2nog/arcgis/rest/services/NDGISHUB_Moose_Units/FeatureServer/0',
        map: (a) => (text(a.UNIT_ID) ? { unit: text(a.UNIT_ID) } : null),
        example: { attributes: { UNIT_TYPE: 'Moose', UNIT_ID: 'M8' }, unit: 'M8', title: 'Moose Unit M8' },
      },
    ],
  },
  {
    code: 'NE',
    name: 'Nebraska',
    agency: 'Nebraska Game and Parks Commission',
    regsUrl: 'https://outdoornebraska.gov/hunting/',
    vintage: '2022 unit boundaries',
    sets: [
      {
        id: 'deer',
        label: 'Deer Management Units',
        noun: 'Deer Unit',
        layer: 'https://services5.arcgis.com/IOshH1zLrIieqrNk/arcgis/rest/services/Deer_Mangement_Units_2022/FeatureServer/0',
        map: (a) => (text(a.UnitName) ? { unit: text(a.UnitName), title: text(a.UnitName), url: httpUrl(a.Hunting_Li), urlLabel: 'Nebraska hunting guides' } : null),
        example: { attributes: { UnitName: 'Blue Northwest', Hunting_Li: 'https://outdoornebraska.gov/guides/' }, unit: 'Blue Northwest', title: 'Blue Northwest' },
      },
      {
        id: 'antelope',
        label: 'Antelope Hunting Units',
        noun: 'Antelope Unit',
        layer: 'https://services5.arcgis.com/IOshH1zLrIieqrNk/arcgis/rest/services/Antelope_Hunting_Units_2022/FeatureServer/0',
        map: (a) =>
          text(a.UnitName)
            ? { unit: text(a.UnitName), title: text(a.UnitName), note: text(a.Limit) ? `Limit: ${text(a.Limit)}` : null, url: httpUrl(a.Hunting_Li), urlLabel: 'Nebraska hunting guides' }
            : null,
        example: { attributes: { UnitName: 'North Sioux Muzzleloader', Limit: 'Either Sex' }, unit: 'North Sioux Muzzleloader', title: 'North Sioux Muzzleloader' },
      },
    ],
  },
  {
    code: 'NH',
    name: 'New Hampshire',
    agency: 'New Hampshire Fish and Game Department',
    regsUrl: 'https://www.wildlife.nh.gov/hunting-nh',
    vintage: '',
    sets: [
      {
        id: 'wmu',
        label: 'Wildlife Management Units',
        noun: 'WMU',
        layer: 'https://services8.arcgis.com/hg1B9Egwk1I5p300/arcgis/rest/services/WMU/FeatureServer/0',
        map: (a) => (text(a.WMU) ? { unit: text(a.WMU) } : null),
        example: { attributes: { WMU: 'A2', MOOSEMGT: 'CT Lakes Region' }, unit: 'A2', title: 'WMU A2' },
      },
    ],
  },
  {
    code: 'NJ',
    name: 'New Jersey',
    agency: 'New Jersey Department of Environmental Protection',
    regsUrl: 'https://dep.nj.gov/njfw/hunting/',
    vintage: '',
    sets: [
      {
        id: 'deer',
        label: 'Deer Management Zones',
        noun: 'Deer Management Zone',
        layer: 'https://services1.arcgis.com/QWdNfRs7lkPq4g4Q/arcgis/rest/services/Deer_Management_Zones_in_New_Jersey/FeatureServer/159',
        map: (a) =>
          text(a.DMZ)
            ? { unit: text(a.DMZ), url: httpUrl(a.ZONE_DESC), urlLabel: 'Zone description', url2: httpUrl(a.REGULATION), url2Label: 'Deer regulations (PDF)' }
            : null,
        example: {
          attributes: { DMZ: 34, ZONE_DESC: 'https://dep.nj.gov/njfw/hunting/deer-management-zone-descriptions/#zone34', REGULATION: 'https://dep.nj.gov/wp-content/uploads/njfw/deerregs.pdf' },
          unit: '34',
          title: 'Deer Management Zone 34',
        },
      },
    ],
  },
  {
    code: 'NM',
    name: 'New Mexico',
    agency: 'New Mexico Department of Game and Fish',
    regsUrl: 'https://www.wildlife.state.nm.us/hunting/',
    vintage: '',
    sets: [
      {
        id: 'gmu',
        label: 'Game Management Units',
        noun: 'GMU',
        layer: 'https://services2.arcgis.com/CjbW1bVhK4dB3WOa/arcgis/rest/services/NMDGF_Game_Management_Units_I_E__v2_WFL1/FeatureServer/0',
        map: (a) => (text(a.GMU) ? { unit: text(a.GMU), url: httpUrl(a.GMU_PDF), urlLabel: 'GMU map (PDF)', url2: httpUrl(a.HUNT_INFO), url2Label: 'NMDGF hunting information' } : null),
        example: {
          attributes: { GMU: '2A', GMU_PDF: 'http://wildlife.dgf.nm.gov/wp-content/uploads/2014/06/game-management-unit-map-boundaries-highres-2a.pdf', HUNT_INFO: 'http://www.wildlife.state.nm.us/hunting/' },
          unit: '2A',
          title: 'GMU 2A',
        },
      },
    ],
  },
  {
    code: 'NV',
    name: 'Nevada',
    agency: 'Nevada Department of Wildlife',
    regsUrl: 'https://www.ndow.org/hunt/',
    vintage: '',
    sets: [
      {
        id: 'unit',
        label: 'Hunt Units',
        noun: 'Unit',
        layer: 'https://services.arcgis.com/RyxlXSfFi87rAosq/arcgis/rest/services/NDOW_Hunt_Units/FeatureServer/0',
        map: (a) => {
          // NDOW's "current active hunting units" layer also holds closed areas (refuges, ranges), named rather than numbered.
          if (text(a.is_active) !== 'true' || text(a.is_open) !== 'true') return null;
          const unit = text(a.display_name);
          return unit ? { unit } : null;
        },
        example: { attributes: { display_name: '051', is_open: 'true', is_active: 'true', year_activated: 2010 }, unit: '051', title: 'Unit 051' },
      },
    ],
  },
  {
    code: 'NY',
    name: 'New York',
    agency: 'New York State Department of Environmental Conservation',
    regsUrl: 'https://dec.ny.gov/things-to-do/hunting',
    vintage: '',
    sets: [
      {
        id: 'wmu',
        label: 'Wildlife Management Units',
        noun: 'WMU',
        layer: 'https://services6.arcgis.com/DZHaqZm9cxOD4CWM/arcgis/rest/services/Wildlife_Management_Units/FeatureServer/0',
        map: (a) => (text(a.UNIT) ? { unit: text(a.UNIT), url: httpUrl(a.MOREINFO), urlLabel: 'DEC unit information' } : null),
        example: { attributes: { UNIT: '4L', MOREINFO: 'https://www.dec.ny.gov/outdoor/8302.html' }, unit: '4L', title: 'WMU 4L' },
      },
    ],
  },
  {
    code: 'OR',
    name: 'Oregon',
    fullResolution: true, // ODFW: "Boundaries may not be altered without permission" — so no simplification
    agency: 'Oregon Department of Fish and Wildlife',
    regsUrl: 'https://myodfw.com/big-game-hunting',
    vintage: '',
    sets: [
      {
        id: 'wmu',
        label: 'Wildlife Management Units',
        noun: 'Unit',
        layer: 'https://nrimp.dfw.state.or.us/arcgis/rest/services/ODFW_Admin/WildlifeManagementUnits/FeatureServer/0',
        map: (a) => {
          const unit = text(a.UNIT_NUM);
          return unit ? { unit, title: joinTitle(`Unit ${unit}`, titleCase(text(a.UNIT_NAME))) } : null;
        },
        example: { attributes: { UNIT_NUM: 27, UNIT_NAME: 'CHETCO', REGION: 'WEST' }, unit: '27', title: 'Unit 27 – Chetco' },
      },
    ],
  },
  {
    code: 'PA',
    name: 'Pennsylvania',
    agency: 'Pennsylvania Game Commission',
    regsUrl: 'https://www.pa.gov/agencies/pgc/huntingandtrapping',
    vintage: '',
    sets: [
      {
        id: 'wmu',
        label: 'Wildlife Management Units',
        noun: 'WMU',
        layer: 'https://services1.arcgis.com/k8yxvICm95iIFicb/arcgis/rest/services/PGC_Boundaries/FeatureServer/301',
        where: "wmu_status='Active'",
        map: (a) => (text(a.wmu_id) ? { unit: text(a.wmu_id), note: text(a.wmu_antler_restriction) ? `Antler restriction: ${text(a.wmu_antler_restriction)}` : null } : null),
        example: { attributes: { wmu_id: '1A', wmu_status: 'Active', wmu_antler_restriction: 'Three Up' }, unit: '1A', title: 'WMU 1A' },
      },
      {
        id: 'elk',
        label: 'Elk Hunt Zones',
        noun: 'Elk Hunt Zone',
        layer: 'https://services1.arcgis.com/k8yxvICm95iIFicb/arcgis/rest/services/PGC_Hunting_Boundaries/FeatureServer/301',
        map: (a) => (text(a.elk_hunt_zone) ? { unit: text(a.elk_hunt_zone) } : null),
        example: { attributes: { elk_hunt_zone: 300, elk_hunt_zone_name: 'Zone 300' }, unit: '300', title: 'Elk Hunt Zone 300' },
      },
    ],
  },
  {
    code: 'SC',
    name: 'South Carolina',
    agency: 'South Carolina Department of Natural Resources',
    regsUrl: 'https://www.dnr.sc.gov/hunting.html',
    vintage: '',
    sets: [
      {
        id: 'zone',
        label: 'Game Zones',
        noun: 'Game Zone',
        layer: 'https://services.arcgis.com/acgZYxoN5Oj8pDLa/arcgis/rest/services/South_Carolina_Game_Zones/FeatureServer/0',
        map: (a) => (text(a.GameZone) ? { unit: text(a.GameZone) } : null),
        example: { attributes: { GameZone: '1' }, unit: '1', title: 'Game Zone 1' },
      },
    ],
  },
  {
    code: 'UT',
    name: 'Utah',
    agency: 'Utah Division of Wildlife Resources',
    regsUrl: 'https://wildlife.utah.gov/hunting',
    vintage: '2025 hunt boundaries',
    sets: [
      {
        id: 'bighunt',
        label: 'Big Game Hunt Boundaries',
        noun: 'Hunt Boundary',
        layer: 'https://services.arcgis.com/ZzrwjTRez6FJiOq4/arcgis/rest/services/Utah_Big_Game_Hunt_Boundaries_2025/FeatureServer/0',
        map: (a) => (text(a.Boundary_Name) ? { unit: text(a.Boundary_Name), title: text(a.Boundary_Name) } : null),
        example: { attributes: { Boundary_Name: 'North Slope, Three Corners', BoundaryID: 140 }, unit: 'North Slope, Three Corners', title: 'North Slope, Three Corners' },
      },
    ],
  },
  {
    code: 'VT',
    name: 'Vermont',
    agency: 'Vermont Fish & Wildlife Department',
    regsUrl: 'https://vtfishandwildlife.com/hunt',
    vintage: '',
    sets: [
      {
        id: 'wmu',
        label: 'Wildlife Management Units',
        noun: 'WMU',
        layer: 'https://anrmaps.vermont.gov/arcgis/rest/services/Open_Data/OPENDATA_ANR_BOUNDARIES_SP_NOCACHE_v2/MapServer/164',
        map: (a) => (text(a.BOUNDARY) ? { unit: text(a.BOUNDARY) } : null),
        example: { attributes: { ABNAME: 'WILDLIFE MANAGEMENT UNITS', BOUNDARY: 'B', AGENCY: 'ANR' }, unit: 'B', title: 'WMU B' },
      },
    ],
  },
  {
    code: 'WA',
    name: 'Washington',
    agency: 'Washington Department of Fish and Wildlife',
    regsUrl: 'https://wdfw.wa.gov/hunting',
    vintage: 'April 2026 – March 2027',
    sets: [
      {
        id: 'gmu',
        label: 'Game Management Units',
        noun: 'GMU',
        layer: 'https://geodataservices.wdfw.wa.gov/arcgis/rest/services/MapServices/HOReferenceService/MapServer/0',
        map: (a) => {
          const unit = text(a.GMU_Num);
          return unit ? { unit, title: joinTitle(`GMU ${unit}`, text(a.GMU_Name)), note: text(a.In_Effect_Desc) ? `In effect ${text(a.In_Effect_Desc)}` : null } : null;
        },
        example: {
          attributes: { GMU_Num: 568, GMU_Name: 'Washougal', WDFWReg_Num: 5, In_Effect_Desc: 'April 1 2026 to March 31 2027' },
          unit: '568',
          title: 'GMU 568 – Washougal',
        },
      },
    ],
  },
  {
    code: 'WI',
    name: 'Wisconsin',
    agency: 'Wisconsin Department of Natural Resources',
    regsUrl: 'https://dnr.wisconsin.gov/topic/hunt',
    vintage: '',
    sets: [
      {
        id: 'deer',
        label: 'Deer Management Units',
        noun: 'Deer Management Unit',
        layer: 'https://dnrmaps.wi.gov/arcgis/rest/services/WM_CWD/WM_DMU_MSU_DMZ_Ext/MapServer/2',
        map: (a) => {
          const unit = text(a.DEER_MGMT_UNIT_ID);
          if (!unit) return null;
          return { unit, title: joinTitle(`DMU ${unit}`, text(a.DEER_MANAGEMENT_ZONE)) };
        },
        example: {
          attributes: { DEER_MANAGEMENT_ZONE: 'Central Forest Zone', DEER_MGMT_UNIT_ID: '203', DEER_MGMT_UNIT_NAME: '203 - Central Forest Zone' },
          unit: '203',
          title: 'DMU 203 – Central Forest Zone',
        },
      },
    ],
  },
  {
    code: 'WY',
    name: 'Wyoming',
    agency: 'Wyoming Game and Fish Department',
    regsUrl: 'https://wgfd.wyo.gov/hunting-trapping',
    vintage: '2025–2026 hunt areas',
    sets: [
      {
        id: 'elk',
        label: 'Elk Hunt Areas',
        noun: 'Elk Hunt Area',
        layer: `${WY}/ElkHuntAreas/FeatureServer/0`,
        map: (a) => (text(a.HUNTAREA) ? { unit: text(a.HUNTAREA), title: joinTitle(`Elk Hunt Area ${text(a.HUNTAREA)}`, text(a.HUNTNAME)), note: text(a.HERDNAME) ? `${text(a.HERDNAME)} herd` : null } : null),
        example: { attributes: { HUNTAREA: 38, HERDUNIT: 251, HERDNAME: 'North Bighorn', HUNTNAME: 'Tongue' }, unit: '38', title: 'Elk Hunt Area 38 – Tongue' },
      },
      {
        id: 'deer',
        label: 'Deer Hunt Areas',
        noun: 'Deer Hunt Area',
        layer: `${WY}/2026_Deer_Hunt_Areas/FeatureServer/0`,
        map: (a) => (text(a.HUNTAREA) ? { unit: text(a.HUNTAREA), title: joinTitle(`Deer Hunt Area ${text(a.HUNTAREA)}`, text(a.HUNTNAME)), note: text(a.MD_HERDNAM) ? `Mule deer: ${text(a.MD_HERDNAM)} herd` : null } : null),
        example: { attributes: { HUNTAREA: 105, HUNTNAME: 'Beartooth', MD_HERDNAM: "Clark's Fork" }, unit: '105', title: 'Deer Hunt Area 105 – Beartooth' },
      },
      {
        id: 'antelope',
        label: 'Antelope Hunt Areas',
        noun: 'Antelope Hunt Area',
        layer: `${WY}/AntelopeHuntAreas/FeatureServer/0`,
        map: (a) => (text(a.HUNTAREA) ? { unit: text(a.HUNTAREA), title: joinTitle(`Antelope Hunt Area ${text(a.HUNTAREA)}`, text(a.HUNTNAME)) } : null),
        example: { attributes: { HUNTAREA: 80, HERDNAME: 'Badger Basin', HUNTNAME: 'Badger Basin' }, unit: '80', title: 'Antelope Hunt Area 80 – Badger Basin' },
      },
      {
        id: 'moose',
        label: 'Moose Hunt Areas',
        noun: 'Moose Hunt Area',
        layer: `${WY}/2026_Moose_Hunt_Areas/FeatureServer/0`,
        map: (a) => (text(a.HUNTAREA) ? { unit: text(a.HUNTAREA), title: joinTitle(`Moose Hunt Area ${text(a.HUNTAREA)}`, text(a.HUNTNAME)) } : null),
        example: { attributes: { HUNTAREA: 1, HERDNAME: 'Bighorn', HUNTNAME: 'Goose Creek' }, unit: '1', title: 'Moose Hunt Area 1 – Goose Creek' },
      },
      {
        id: 'bear',
        label: 'Black Bear Hunt Areas',
        noun: 'Black Bear Hunt Area',
        layer: `${WY}/BlackBearHuntAreas/FeatureServer/0`,
        map: (a) => (text(a.HUNTAREA) ? { unit: text(a.HUNTAREA), title: joinTitle(`Black Bear Hunt Area ${text(a.HUNTAREA)}`, text(a.MGMTUNIT)) } : null),
        example: { attributes: { HUNTAREA: '32', MGMTUNIT: 'Absaroka' }, unit: '32', title: 'Black Bear Hunt Area 32 – Absaroka' },
      },
    ],
  },
];

export const HUNT_STATE_BY_CODE: Record<string, HuntStateConfig> = Object.fromEntries(HUNT_STATES.map((s) => [s.code, s]));
