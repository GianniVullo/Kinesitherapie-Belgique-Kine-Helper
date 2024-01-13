import dayjs from 'dayjs';
import { NomenclatureManager } from '$lib/utils/nomenclatureManager';
import { get, writable } from 'svelte/store';
import { user } from '../../../../../../../lib/stores/UserStore';
import { indmeniteCategory } from '../../../../../../../lib/stores/codeDetails';

export function createAttestationFormState(patient, untill, page) {
	console.log('in createAttestationFormState with ', patient, untill, page);

	//* ETAPE 1 : Initialisation : variable de base et trouver la séance limite en date
	let { state, loading, sp, lastSeance } = initialisation(patient, untill, page);

	//* ETAPE 2 il faut prendre une liste de séance précédant la séance limite (en l'incluant)
	let seances = filtrageSeanceNonAttesteeJusqua(lastSeance, sp);
	console.log('Les séances', seances);

	//* ETAPE 3 il faut construire l'objet State
	//? Il faut maintenant trouver tous les codes pour pouvoir accéder aux informations cruciales telles que le lieu_id ou les honoraires
	let { futureStateArray, codeMap, index } = initialisationIntermediaire();
	fetchCodeDesSeances(loading, seances, sp).then((codes) => {
		constructionEtMiseAJourDeAttestationFormState(
			loading,
			seances,
			sp,
			codes,
			futureStateArray,
			index
		);
		console.log('futureStateArray BEFORE CHAMP MANQUANT', futureStateArray);
		//* ÉTAPE 4 : Réitérer aux travers de toutes les attestations pour ajouter les champs manquants et les honoraires des lignes implicites (intake, indemnité et rapport écrit)
		champsManquantsEtLignesImplicites(futureStateArray, codes, patient, sp);
		//* ÉTAPE 5 : Mettre à jour l'objet state et codeMap
		state.set(futureStateArray);
		codeMap.set(codes);
	});
	return {
		state,
		loading,
		codeMap
	};
}

export function updateAttestationFormState(patient, state, page, codes) {
	console.log('in updateAttestationFormState with ', patient, state, page, codes);
	const sp = patient.situations_pathologiques.find((sp) => sp.sp_id === page.params.spId);

	champsManquantsEtLignesImplicites(state, codes, patient, sp);
}

function initialisation(patient, untill, page) {
	let state = writable([]);
	let loading = writable(false);

	const sp = patient.situations_pathologiques.find((sp) => sp.sp_id === page.params.spId);
	let lastSeance;

	if (untill) {
		console.log('untill', untill);
		// trouver la dernière séance à cette date
		let untillDate = dayjs(untill);
		lastSeance = sp.seances.find((seance) => {
			return dayjs(dayjs(seance.date).format('YYYY-MM-DD')).isSame(untillDate);
		});
	} else {
		console.log('pas de untill');
		let untillDate = dayjs(dayjs().format('YYYY-MM-DD'));
		console.log('untillDate', untillDate);
		let filteredSeances = sp.seances.filter((seance) => {
			return dayjs(dayjs(seance.date).format('YYYY-MM-DD')).isBefore(untillDate);
		});
		console.log('filteredSeances', filteredSeances);
		lastSeance = filteredSeances[filteredSeances.length - 1];
	}
	console.log('La dernière séance', lastSeance);
	return { state, loading, sp, lastSeance };
}

function fetchCodeDesSeances(loading, seances, sp) {
	let guesseur = new NomenclatureManager();
	loading.update((n) => true);
	return new Promise((resolve, reject) => {
		guesseur
			.bulkGuess(seances, async (seances, db) => {
				for (const seance of seances) {
					await guesseur.getCode(seance, db);
				}
				if (sp.with_indemnity || sp.with_rapport || sp.with_intake) {
					await guesseur.collectIndemnitIntakeeEtRapporEcrit();
				}
			})
			.then(() => {
				console.log("guesseur's cache", guesseur.cache);
				resolve(guesseur.cache);
			});
	});
}

function filtrageSeanceNonAttesteeJusqua(lastSeance, sp) {
	return sp.seances.filter((seance) => {
		return (
			(dayjs(seance.date).isSame(dayjs(lastSeance.date)) ||
				dayjs(seance.date).isBefore(dayjs(lastSeance.date))) &&
			!seance.has_been_attested
		);
	});
}

function createCodeMap() {
	let codeMap = writable();
	function groupes_has_rapport() {
		let groupes = [];
		let codes = get(codeMap);
		for (const codeId of codes.keys()) {
			if (Array.isArray(codes.get(codeId))) {
				for (const code of codes.get(codeId)) {
					groupes.push(code.groupe_id);
				}
				continue;
			}
			groupes.push(codes.get(codeId).groupe_id);
		}
		return groupes.includes(1) || groupes.includes(4) || groupes.includes(5);
	}
	function groupes_has_intake() {
		let groupes = [];
		let codes = get(codeMap);
		for (const codeId of codes.keys()) {
			if (Array.isArray(codes.get(codeId))) {
				for (const code of codes.get(codeId)) {
					groupes.push(code.groupe_id);
				}
				continue;
			}
			groupes.push(codes.get(codeId).groupe_id);
		}
		return groupes.includes(0);
	}
	return {
		subscribe: codeMap.subscribe,
		set: codeMap.set,
		update: codeMap.update,
		groupes_has_rapport,
		groupes_has_intake
	};
}
function initialisationIntermediaire() {
	//? d'abord créer un tableau qui sera utilisé pour mettre à jour l'objet state
	let futureStateArray = [];
	//? ensuite créer un store pour stocker les codes trouver par le NomenclatureManager
	let codeMap = createCodeMap();
	//? ensuite définir un index incrémental pour garder le compte des attestations créées sans faire d'appel à la propriété length de la nested array attestations
	let index = 0;
	return { futureStateArray, codeMap, index };
}
function constructionEtMiseAJourDeAttestationFormState(
	loading,
	seances,
	sp,
	codes,
	futureStateArray,
	index
) {
	loading.update((n) => false);
	console.log('Les codes', codes);
	//? On itère donc sur toutes les séances pour pouvoir les classer d'abord par Prescription et ensuite par Attestation
	for (const seance of seances) {
		//* étape 3a : trouver le code de la séance
		let code = codes.get(seance.code_id);
		//* étape 3b : trouver la prescription de la séance
		let prescr = getPrescr(seance.prescription_id);
		console.log('prescr', prescr);
		//* étape 3.b.2 : si la prescription n'existe pas, il faut la créer et la prépeupler avec la première attestation et la première séance
		if (!prescr) {
			//? initialisation de la prescription
			let prescriptionState = buildPrescriptionState(sp, seance);
			// Comme il s'agit ici de la première Attestation, nous pouvons être confiant de calculer l'intake, le rapport écrit et le porte_prescr
			let attestationState = buildAttestationState(index, sp, {
				with_intake: sp.intake && sp.attestations?.length === 0,
				porte_prescr: sp.attestations?.length === 0 && !prescription.jointe_a ? true : false,
				with_indemnity: code.lieu_id === 3
			});
			console.log('attestationState RIGHT AFTER CREATION', attestationState);
			//? initialisation de la séance
			let seanceState = buildSeanceState(seance, {});
			attestationState.seances.push(seanceState);
			prescriptionState.attestations.push(attestationState);
			futureStateArray.push(prescriptionState);
			index++;
			prescr = getPrescr(seance.prescription_id);
			console.log('newly created prescr', prescr);
			continue;
		}
		//* ETAPE 3c : Il faut ajouter les attestations aux prescriptions
		//? Il faut ici simplement s'assurer que l'attestation ne contient pas plus de 20 lignes.
		//? 3c1 : trouver l'attestation avec l'index - 1
		let attestation = prescr.attestations.find((a) => a.id === index - 1);
		//? 3C2 : Si l'attestation a plus de 20 lignes, il faut créer une nouvelle attestation.
		if (aMoinsDe20Lignes(attestation)) {
			let attestationState = buildAttestationState(index, sp, {
				with_intake: false,
				porte_prescr: false,
				with_indemnity: code.lieu_id === 3
			});
			console.log('attestationState AFTER AMOINSDE20LINGES', attestationState);
			let seanceState = buildSeanceState(seance, {});
			attestationState.seances.push(seanceState);
			futureStateArray
				.find((s) => s.obj.prescription_id === seance.prescription_id)
				.attestations.push(attestationState);
			index++;
			continue;
		}
		//? 3D : Si l'attestation a moins de 20 lignes, il faut ajouter la séance à l'attestation
		let seanceState = buildSeanceState(seance, {});
		futureStateArray
			.find((s) => s.obj.prescription_id === seance.prescription_id)
			.attestations.find((a) => a.id === index - 1)
			.seances.push(seanceState);
	}

	function getPrescr(p_id) {
		return futureStateArray.find((s) => s.obj.prescription_id === p_id);
	}
}
function getUnitRecu(code, patient) {
	// Calcul le montant que le patient doit donner au kiné
	let ticket_moderateur =
		code.remboursement[
			`part_personnelle${patient.bim ? '_pref' : '_nopref'}${
				get(user).profil.conventionne ?? true ? '_conv' : '_noconv'
			}`
		];
	let tiers_payant =
		code.remboursement[
			`intervention${patient.bim ? '_pref' : '_nopref'}${
				get(user).profil.conventionne ?? true ? '_conv' : '_noconv'
			}`
		];
	return parseFloat(
		(
			(patient.ticket_moderateur ? ticket_moderateur : 0.0) +
			(patient.tiers_payant ? 0.0 : tiers_payant)
		).toFixed(2)
	);
}
function getUnitTotal(code) {
	return parseFloat(code.honoraire.toFixed(2));
}

function champsManquantsEtLignesImplicites(futureStateArray, codes, patient, sp) {
	console.log('in champsManquantsEtLignesImplicites wtih ', futureStateArray);
	//? Itérer au travers des prescriptions de State
	for (let pIdx = 0; pIdx < futureStateArray.length; pIdx++) {
		//? Itérer au travers des attestations de chaque prescription
		for (let aIdx = 0; aIdx < futureStateArray[pIdx].attestations.length; aIdx++) {
			let attestation = futureStateArray[pIdx].attestations[aIdx];
			attestation.total_recu = 0.0;
			attestation.valeur_totale = 0.0;
			//? Ici on évalue si le cas de figue où l'attestation est la première et qu'elle contient un rapport écrit
			if (sp.rapport_ecrit && sp.rapport_ecrit_date === 'first') {
				if (sp.attestations?.length === 0 && pIdx === 0 && aIdx === 0) {
					attestation.with_rapport = true;
					attestation.seances[0].has_rapport = true;
				}
			}

			for (const seance of attestation.seances) {
				let code = codes.get(seance.obj.code_id);
				//? Ajout de l'indemnité de dplcmts
				//*  4.a : on ajoute la ligne implicite indemnité si nécessaire
				if (attestation.with_indemnity) {
					let codeIdemnite = codes
						.get('indemnites')
						.find((c) => c.code_reference === indmeniteCategory[code.groupe_id]);
					console.log('codeIdemnite', codeIdemnite);
					let indemnity_recu_value = getUnitRecu(codeIdemnite, patient);
					let indemnity_total_value = getUnitTotal(codeIdemnite);
					console.log('indemnity_recu_value', indemnity_recu_value);
					console.log('indemnity_total_value', indemnity_total_value);
					attestation.total_recu += indemnity_recu_value;
					attestation.valeur_totale += indemnity_total_value;
				}
				//? Si le rapport écrit n'est pas 'first' alors il faut trouver la bonne attestation pour ajouter le rapport écrit
				if (
					sp.rapport_ecrit &&
					(sp.rapport_ecrit_date === 'last' || sp.rapport_ecrit_date === 'custom')
				) {
					if (dayjs(seance.obj.date).isSame(dayjs(sp.rapport_ecrit_date_custom))) {
						attestation.with_rapport = true;
						seance.has_rapport = true;
					}
				}
				//* 4.b : on ajoute la ligne explicite
				attestation.total_recu += getUnitRecu(codes.get(seance.obj.code_id), patient);
				attestation.valeur_totale += getUnitTotal(codes.get(seance.obj.code_id));
			}
			//* 4.c si l'attestation contient un rapport écrit, il faut ajouter la valeur du rapport écrit au total_recu et à la valeur_totale
			if (attestation.with_rapport) {
				let seance = attestation.seances.find((s) => s.has_rapport);
				let rapport = codes
					.get('rapports')
					.find((c) => c.lieu_id === codes.get(attestation.seances[0].obj.code_id).lieu_id);
				attestation.total_recu = attestation.total_recu + getUnitRecu(rapport, patient);
				attestation.valeur_totale = attestation.valeur_totale + getUnitTotal(rapport);
			}
			//* 4.d si l'attestation contient un intake, il faut ajouter la valeur de l'intake au total_recu et à la valeur_totale
			if (attestation.with_intake) {
				let intake = codes
					.get('intake')
					.find((c) => c.lieu_id === codes.get(attestation.seances[0].obj.code_id).lieu_id);
				attestation.total_recu = attestation.total_recu + getUnitRecu(intake, patient);
				attestation.valeur_totale = attestation.valeur_totale + getUnitTotal(intake);
			}
			attestation.date = dayjs(attestation.seances[attestation.seances.length - 1].obj.date).format(
				'YYYY-MM-DD'
			);
		}
	}
	console.log('futureStateArray', futureStateArray);
}

function buildPrescriptionState(sp, seance) {
	return {
		toBeProduced: true,
		attestations: [],
		obj: sp.prescriptions.find(
			(prescription) => prescription.prescription_id === seance.prescription_id
		)
	};
}

function buildAttestationState(
	id,
	sp,
	{ with_intake, porte_prescr, with_indemnity, has_been_printed = true }
) {
	return {
		id,
		toBeProduced: true,
		with_indemnity,
		with_intake,
		with_rapport: null, // rapport écrit c'est mieux de le calculer après car il pourrait être custom et nous ne pouvons pas être sûr que la séance où le rapport devrait être fait sera sur cette attestation
		date: null,
		porte_prescr,
		numero_etablissment: sp.numero_etablissment,
		service: sp.service,
		has_been_printed,
		total_recu: 0.0,
		valeur_totale: 0.0,
		seances: []
	};
}

function buildSeanceState(seance, { selected = true, modified = false }) {
	return {
		obj: seance,
		selected,
		modified,
		has_rapport: false
	};
}

function aMoinsDe20Lignes(attestation) {
	return (
		attestation.seances.length ===
		(attestation.with_indemnity
			? attestation.with_rapport || attestation.with_intake
				? 9
				: 10
			: attestation.with_rapport || attestation.with_intake
			? 19
			: 20)
	);
}
